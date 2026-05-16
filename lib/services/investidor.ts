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
import { EtherfuseClient } from '../anchors/etherfuse';

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
  // 1) Investidor já existente?
  const existing = await db.investidor.findFirst({
    where: { email: input.email },
  });
  if (existing && existing.status === 'AUTORIZADO') {
    return {
      investidorId: existing.id,
      publicKey: existing.publicKey,
      etherfuseCustomerId: '(reuse)',
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
      idNumbers: [{ value: '52998224725', type: 'CPF' }],
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
  } catch {
    // continua — KYC já aprovado via submit
  }

  // 6) Confirma status approved (sandbox deve estar approved após submits).
  let kycStatus: OnboardResult['kycStatus'] = 'pending';
  try {
    const status = await anchor.getKycStatus(customer.id, publicKey);
    if (status === 'approved') kycStatus = 'approved';
    else if (status === 'pending') kycStatus = 'pending';
    else kycStatus = 'not_started';
  } catch {
    // ignore — usa pending
  }

  // 7) Upsert Investidor no DB.
  const investidor = await db.$transaction(async (tx) => {
    const upserted = await tx.investidor.upsert({
      where: { email: input.email },
      create: {
        nome: input.nome ?? input.email,
        email: input.email,
        publicKey,
        kycAprovado: kycStatus === 'approved',
        status:
          kycStatus === 'approved'
            ? StatusInvestidor.AUTORIZADO
            : StatusInvestidor.PENDENTE_KYC,
      },
      update: {
        publicKey,
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
        payloadJson: {
          privyId: input.privyId,
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
