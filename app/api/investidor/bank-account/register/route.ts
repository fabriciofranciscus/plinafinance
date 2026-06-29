/**
 * POST /api/investidor/bank-account/register
 *
 * PLINA-MOD-006: registra bank PIX programaticamente na Etherfuse (descoberta
 * 2026-05-25 via etherfuse-pix-demo gap #3). Sem isso, on-ramp PIX/BRL
 * sempre cai no mock. Pré-req: customer onboarded (etherfuseCustomerId
 * presente) + KYC approved.
 *
 * Body: { pixKey, pixKeyType, cpf, firstName, lastName }
 * Returns: { bankAccountId, status, idempotent? }
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    pixKey: z.string().min(1).max(200),
    pixKeyType: z.enum(['cpf', 'email', 'phone', 'random']),
    cpf: z.string().min(11).max(40),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { pixKey, pixKeyType, cpf, firstName, lastName } = Schema.parse(
    await req.json(),
  );

  const investidor = await db.investidor.findUnique({
    where: { id: user.investidorId },
    select: {
      id: true,
      publicKey: true,
      etherfuseCustomerId: true,
      etherfuseBankAccountId: true,
    },
  });
  if (!investidor) {
    throw new ApiError('NOT_FOUND', 404, 'investidor não encontrado');
  }
  if (!investidor.etherfuseCustomerId) {
    throw new ApiError(
      'CONFLICT',
      409,
      'investidor sem etherfuseCustomerId — refaça onboarding',
    );
  }

  // Idempotência: bank já registrado.
  if (investidor.etherfuseBankAccountId) {
    return ok(
      {
        bankAccountId: investidor.etherfuseBankAccountId,
        status: 'active',
        idempotent: true,
      },
      { requestId },
    );
  }

  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('ETHERFUSE_API_KEY ausente');
  }
  const anchor = new EtherfuseClient({
    apiKey,
    baseUrl: process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });

  const custId = investidor.etherfuseCustomerId;
  const persistBank = async (id: string, status: string, reused: boolean) => {
    await db.$transaction(async (tx) => {
      await tx.investidor.update({
        where: { id: investidor.id },
        data: { etherfuseBankAccountId: id },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'BANK_ACCOUNT_REGISTRADA',
          operador: 'investidor-self-service',
          investidorId: investidor.id,
          privyId: user.privyId,
          payloadJson: {
            accountId: id,
            status,
            reused,
          } as Prisma.InputJsonValue,
        },
      });
    });
  };

  // Reuso: se o customer já tem fiat account na Etherfuse (re-teste, ou
  // registrada noutro fluxo), reaproveita em vez de criar — evita o limite
  // "Only one BRL bank account is allowed per organization" do sandbox.
  // Usado no pré-check e de novo no catch do register (corrida org-level).
  const tryReusePix = async () => {
    const accounts = await anchor.getFiatAccounts(custId).catch(() => []);
    const pix = accounts.find((a) => a.type === 'PIX') ?? accounts[0];
    if (!pix) return null;
    await persistBank(pix.id, 'active', true);
    return ok(
      { bankAccountId: pix.id, status: 'active', idempotent: true },
      { requestId },
    );
  };

  const reused = await tryReusePix();
  if (reused) return reused;

  // Gera novo stub bankAccountId pro presignedUrl. Etherfuse aceita
  // qualquer UUID; o register depois amarra esse UUID ao customer.
  const bankAccountStubId = crypto.randomUUID();
  const presignedUrl = await anchor.getKycUrl(
    custId,
    investidor.publicKey,
    bankAccountStubId,
  );

  let bankResp;
  try {
    bankResp = await anchor.registerPixBankAccount(presignedUrl, {
      pixKey,
      pixKeyType,
      cpf,
      firstName,
      lastName,
    });
  } catch (regErr) {
    // Limite org-level do sandbox: pode haver uma conta criada após o check
    // acima (corrida) ou sob este customer. Tenta reaproveitar antes de falhar.
    const reusedAfterRace = await tryReusePix();
    if (reusedAfterRace) return reusedAfterRace;
    throw regErr;
  }

  const accountId =
    (bankResp as unknown as { accountId?: string; bankAccountId?: string })
      .accountId ?? bankResp.bankAccountId;
  if (!accountId) {
    // Erro operacional do anchor — safe surfaciar (não vaza secret).
    throw new ApiError(
      'ETHERFUSE_ERROR',
      502,
      'Etherfuse retornou response sem accountId',
    );
  }

  await persistBank(accountId, bankResp.status, false);

  return ok({ bankAccountId: accountId, status: bankResp.status }, { requestId });
});
