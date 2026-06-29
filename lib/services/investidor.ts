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

import { Prisma, Papel, StatusInvestidor } from '@prisma/client';
import { db } from '../db';
import { STELLAR_NETWORK } from '../stellar/config';
import { loadAccount } from '../stellar/account';
import { assetCodeForClasse } from '../stellar/classes';
import { resolveTesouroAsset } from '../anchors/etherfuse/tesouro';
import { ensureKycForPessoa } from './pessoa';
import { ApiError } from '../api/errors';

/**
 * Trustlines já estabelecidas on-chain? Fonte de verdade pro identity screen —
 * sem isso o `trustlinesReady` (estado React) reseta a cada reload e o
 * investidor é forçado a re-assinar trustlines que já existem. Checa as 3
 * necessárias: TESOURO (bridge) + PLINARF (Sênior) + PLINARFB (Subordinada).
 * Best-effort: qualquer falha (conta inexistente, Horizon, Etherfuse) → false,
 * caindo no fluxo de setup (idempotente server-side).
 */
export async function investidorTrustlinesReady(
  publicKey: string,
): Promise<boolean> {
  const issuer = process.env.STELLAR_ISSUER_PUBLIC;
  if (!issuer) return false;
  try {
    const [acc, tesouro] = await Promise.all([
      loadAccount(publicKey),
      resolveTesouroAsset(publicKey),
    ]);
    const lines = acc.balances as Array<{
      asset_code?: string;
      asset_issuer?: string;
    }>;
    const has = (code: string, iss: string) =>
      lines.some((b) => b.asset_code === code && b.asset_issuer === iss);
    return (
      has(assetCodeForClasse('SENIOR'), issuer) &&
      has(assetCodeForClasse('SUBORDINADA'), issuer) &&
      has(tesouro.code, tesouro.issuer)
    );
  } catch {
    return false;
  }
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
 * Onboarding completo. Idempotente: o KYC vive na `Pessoa` (keyed por
 * privyId) e é feito UMA vez — se a pessoa já tem KYC aprovado (inclusive
 * vindo do papel cedente), `ensureKycForPessoa` reusa sem re-rodar Etherfuse.
 * Aqui só conectamos/atualizamos o `Investidor` à Pessoa.
 */
export async function onboardInvestidor(
  input: OnboardInput,
): Promise<OnboardResult> {
  // KYC compartilhado (wallet + Etherfuse + Pessoa). emitAudit:false — o log
  // INVESTIDOR_ONBOARDED com investidorId é emitido abaixo (consumido por
  // /minha-posicao + events API).
  const kyc = await ensureKycForPessoa({
    privyId: input.privyId,
    email: input.email,
    nome: input.nome,
    cpf: input.cpf,
    papel: Papel.INVESTIDOR,
    emitAudit: false,
  });

  const status: StatusInvestidor = kyc.kycAprovado
    ? StatusInvestidor.AUTORIZADO
    : StatusInvestidor.PENDENTE_KYC;

  // email não é mais @unique (espelho de Pessoa.email). Localiza o investidor
  // existente por pessoaId (backfillado), privyId (espelho) ou email (legado)
  // pra evitar duplicar a row.
  const found = await db.investidor.findFirst({
    where: {
      OR: [
        { pessoaId: kyc.pessoaId },
        { privyId: input.privyId },
        { email: input.email },
      ],
    },
    select: { id: true },
  });

  const investidor = await db.$transaction(async (tx) => {
    const data = {
      publicKey: kyc.publicKey,
      privyId: input.privyId,
      pessoaId: kyc.pessoaId,
      etherfuseCustomerId: kyc.etherfuseCustomerId,
      etherfuseBankAccountId: kyc.etherfuseBankAccountId ?? undefined,
      cpfNormalizado: kyc.cpfNormalizado,
      isSyntheticCpf: kyc.isSyntheticCpf,
      kycAprovado: kyc.kycAprovado,
      status,
    };
    const upserted = found
      ? await tx.investidor.update({ where: { id: found.id }, data })
      : await tx.investidor.create({
          data: { nome: input.nome ?? input.email, email: input.email, ...data },
        });
    await tx.eventoAudit.create({
      data: {
        acao: 'INVESTIDOR_ONBOARDED',
        operador: 'investidor-self-service',
        investidorId: upserted.id,
        privyId: input.privyId,
        payloadJson: {
          publicKey: kyc.publicKey,
          etherfuseCustomerId: kyc.etherfuseCustomerId,
          kycStatus: kyc.kycStatus,
        } as Prisma.InputJsonValue,
      },
    });
    return upserted;
  });

  return {
    investidorId: investidor.id,
    publicKey: kyc.publicKey,
    etherfuseCustomerId: kyc.etherfuseCustomerId ?? '',
    kycStatus: kyc.kycAprovado
      ? 'approved'
      : kyc.kycStatus === 'PENDENTE'
        ? 'pending'
        : 'not_started',
    fundedNow: kyc.fundedNow,
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
    throw new ApiError(
      'NOT_ONBOARDED',
      403,
      'Investidor não onboardado — trustline negada.',
    );
  }
  if (!investidor.kycAprovado) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'KYC pendente — trustline negada (whitepaper §6.5).',
    );
  }
  if (investidor.status !== StatusInvestidor.AUTORIZADO) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      `Investidor em estado ${investidor.status} — trustline negada.`,
    );
  }
  // N-14: bloqueia operação em mainnet pra investidores carimbados com
  // CPF sintético no onboard (sandbox que viraria mainnet sem re-KYC).
  if (STELLAR_NETWORK === 'PUBLIC' && investidor.isSyntheticCpf) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'Investidor com CPF sintético — exige re-KYC antes de operar em mainnet (N-14).',
    );
  }
}
