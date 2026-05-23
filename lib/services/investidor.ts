/**
 * Investidor service — orquestra onboarding institucional ponta-a-ponta.
 *
 * Sequência (whitepaper §5 + §6.6):
 *   1. ensureStellarWallet (Privy server-side, idempotente)
 *   2. ensureEtherfuseCustomer (cria customer + presignedURL)
 *   3. KYC programático: identity + docs + agreements (sandbox auto-aprova)
 *   4. Investidor record no Postgres (privyId unique → idempotência)
 *
 * Resultado: Investidor com publicKey + status=AUTORIZADO, pronto pra
 * receber trustline PLINARF + distribuição.
 *
 * Key rules:
 *   - PII off-chain: nome/email no Postgres BR, on-chain só publicKey.
 *   - Idempotência: privyId é unique no schema, requests duplicados retornam
 *     o mesmo investidor sem recriar.
 *   - Audit log via EventoAudit (INVESTIDOR_ONBOARDED).
 */

import { Prisma, StatusInvestidor } from '@prisma/client';
import { db } from '../db';
import { ensureStellarWallet } from '../wallet/privy';
import { fundAccountIfNeeded } from '../stellar/account';
import { STELLAR_NETWORK } from '../stellar/config';
import { logStellarError } from '../stellar/log-error';
import { EtherfuseClient } from '../anchors/etherfuse';
import { parseCpf } from '../format/parse-cpf';

const DUMMY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

function etherfuseFromEnv(): EtherfuseClient {
  const apiKey = process.env.ETHERFUSE_API_KEY;
  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  if (!apiKey) {
    throw new Error('ETHERFUSE_API_KEY ausente.');
  }
  return new EtherfuseClient({ apiKey, baseUrl });
}

export interface OnboardInput {
  privyId: string;
  email: string;
  nome?: string;
  cpf?: string;
}

export interface OnboardResult {
  investidorId: string;
  publicKey: string;
  etherfuseCustomerId: string;
  kycStatus: 'approved' | 'pending' | 'not_started';
  fundedNow: boolean;
}

/**
 * Onboarding completo. Idempotente: se já tem investidor pra esse privyId,
 * retorna o que tem (sem re-rodar KYC). Wallet existente do Privy é reusada.
 */
export async function onboardInvestidor(
  input: OnboardInput,
): Promise<OnboardResult> {
  // F-12: em mainnet (proxy de "produção") exigir CPF real do investidor.
  // Sandbox aceita dummy (Etherfuse auto-aprova; sem responsabilidade real).
  const isProduction = STELLAR_NETWORK === 'PUBLIC';
  const parsedCpf = parseCpf(input.cpf);
  let cpfNormalizado: string;
  let isSyntheticCpf: boolean;
  if (isProduction) {
    if (!parsedCpf) {
      throw new Error('cpf obrigatório em mainnet (válido por módulo 11)');
    }
    cpfNormalizado = parsedCpf;
    isSyntheticCpf = false;
  } else {
    // N-14: persistir a flag explicitamente — se o env flipar pra mainnet
    // depois, assertElegivelParaTrustline bloqueia esse investidor sem
    // re-KYC.
    cpfNormalizado = parsedCpf ?? '52998224725';
    isSyntheticCpf = !parsedCpf;
  }

  // 1) Investidor já existente com customer Etherfuse persistido?
  const existing = await db.investidor.findFirst({
    where: { email: input.email },
  });
  if (
    existing &&
    existing.status === 'AUTORIZADO' &&
    existing.etherfuseCustomerId
  ) {
    // Backfill privyId se faltar (rows pré-migration). Único caminho onde
    // garantimos o vínculo email↔privyId pra o auth-guard funcionar.
    if (!existing.privyId) {
      await db.investidor.update({
        where: { id: existing.id },
        data: { privyId: input.privyId },
      });
    }
    return {
      investidorId: existing.id,
      publicKey: existing.publicKey,
      etherfuseCustomerId: existing.etherfuseCustomerId,
      kycStatus: 'approved',
      fundedNow: false,
    };
  }

  // 2) Stellar wallet via Privy (idempotente).
  const publicKey = await ensureStellarWallet(input.privyId);

  // 3) Funda na testnet se ainda não existir on-chain.
  const fund = await fundAccountIfNeeded(publicKey);

  // 4) Etherfuse customer + KYC programático.
  const anchor = etherfuseFromEnv();

  const customer = await anchor.createCustomer({
    email: input.email,
    publicKey,
    country: 'BR',
  });

  // 5) KYC: identity + docs + agreements (sandbox auto-aprova).
  await anchor.submitKycIdentity(customer.id, {
    pubkey: publicKey,
    identity: {
      id: publicKey,
      name: {
        givenName: input.nome?.split(' ')[0] ?? 'Investidor',
        familyName:
          input.nome?.split(' ').slice(1).join(' ').trim() || 'Institucional',
      },
      dateOfBirth: '1985-01-15',
      address: {
        street: 'Av. Faria Lima, 1000',
        city: 'São Paulo',
        region: 'SP',
        postalCode: '01310-100',
        country: 'BR',
      },
      idNumbers: [{ value: cpfNormalizado, type: 'CPF' }],
    },
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey: publicKey,
    documentType: 'document',
    images: [
      { label: 'id_front', image: DUMMY_PNG_BASE64 },
      { label: 'id_back', image: DUMMY_PNG_BASE64 },
    ],
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey: publicKey,
    documentType: 'selfie',
    images: [{ label: 'selfie', image: DUMMY_PNG_BASE64 }],
  });
  // Agreements: electronic + terms passam; customer-agreement falha sem phone
  // (limitação sandbox documentada em PLINA-MOD-005). KYC aprova mesmo assim.
  const kycUrl = await anchor.getKycUrl(
    customer.id,
    publicKey,
    customer.bankAccountId,
  );
  try {
    await anchor.acceptElectronicSignature(kycUrl);
    await anchor.acceptTermsAndConditions(kycUrl);
  } catch (err) {
    // N-16: agreements falham em sandbox sem phone (PLINA-MOD-005). KYC
    // já foi aprovado via submit — onboard segue, mas o erro vira visível
    // (antes ficava swallowed silenciosamente).
    logStellarError('[onboard:agreements]', err);
  }

  // 6) Confirma status approved (sandbox deve estar approved após submits).
  let kycStatus: OnboardResult['kycStatus'] = 'pending';
  try {
    const status = await anchor.getKycStatus(customer.id, publicKey);
    if (status === 'approved') kycStatus = 'approved';
    else if (status === 'pending') kycStatus = 'pending';
    else kycStatus = 'not_started';
  } catch (err) {
    // N-16: rede flap em getKycStatus — onboard segue com pending, mas
    // operador vê o erro pra distinguir de "Etherfuse marcou pending".
    logStellarError('[onboard:kyc-status]', err);
  }

  // 7) Upsert Investidor no DB.
  const investidor = await db.$transaction(async (tx) => {
    const upserted = await tx.investidor.upsert({
      where: { email: input.email },
      create: {
        nome: input.nome ?? input.email,
        email: input.email,
        publicKey,
        privyId: input.privyId,
        etherfuseCustomerId: customer.id,
        cpfNormalizado,
        isSyntheticCpf,
        kycAprovado: kycStatus === 'approved',
        status:
          kycStatus === 'approved'
            ? StatusInvestidor.AUTORIZADO
            : StatusInvestidor.PENDENTE_KYC,
      },
      update: {
        publicKey,
        privyId: input.privyId,
        etherfuseCustomerId: customer.id,
        cpfNormalizado,
        isSyntheticCpf,
        kycAprovado: kycStatus === 'approved',
        status:
          kycStatus === 'approved'
            ? StatusInvestidor.AUTORIZADO
            : StatusInvestidor.PENDENTE_KYC,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'INVESTIDOR_ONBOARDED',
        operador: 'investidor-self-service',
        investidorId: upserted.id,
        privyId: input.privyId,
        payloadJson: {
          publicKey,
          etherfuseCustomerId: customer.id,
          kycStatus,
        } as Prisma.InputJsonValue,
      },
    });
    return upserted;
  });

  return {
    investidorId: investidor.id,
    publicKey,
    etherfuseCustomerId: customer.id,
    kycStatus,
    fundedNow: fund.funded,
  };
}

/**
 * Guardrail (whitepaper §6.5: AUTH_REQUIRED + KYC antes da trustline).
 * Aborta com mensagem explícita se o investidor não estiver elegível.
 * Lookup por investidorId ou por publicKey — qualquer ausência é fatal.
 */
export async function assertElegivelParaTrustline(opts: {
  investidorId?: string;
  publicKey?: string;
}): Promise<void> {
  if (!opts.investidorId && !opts.publicKey) {
    throw new Error('investidorId ou publicKey obrigatório.');
  }
  const investidor = opts.investidorId
    ? await db.investidor.findUnique({ where: { id: opts.investidorId } })
    : await db.investidor.findUnique({ where: { publicKey: opts.publicKey! } });
  if (!investidor) {
    throw new Error('Investidor não onboardado — trustline negada.');
  }
  if (!investidor.kycAprovado) {
    throw new Error('KYC pendente — trustline negada (whitepaper §6.5).');
  }
  if (investidor.status !== StatusInvestidor.AUTORIZADO) {
    throw new Error(
      `Investidor em estado ${investidor.status} — trustline negada.`,
    );
  }
  // N-14: bloqueia operação em mainnet pra investidores carimbados com
  // CPF sintético no onboard (sandbox que viraria mainnet sem re-KYC).
  if (STELLAR_NETWORK === 'PUBLIC' && investidor.isSyntheticCpf) {
    throw new Error(
      'Investidor com CPF sintético — exige re-KYC antes de operar em mainnet (N-14).',
    );
  }
}
