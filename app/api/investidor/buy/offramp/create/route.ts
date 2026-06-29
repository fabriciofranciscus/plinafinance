/**
 * POST /api/investidor/buy/offramp/create
 *
 * Cria uma order de offramp TESOURO → BRL na Etherfuse, persistida como
 * `OffRampOrder` no DB e atada ao `Quote` (1:1). Inverso do
 * `/onramp/create`.
 *
 * Quando a Etherfuse rejeita por "Proxy account not found"
 * (PLINA-MOD-005, ainda existe na prática quando o customer não fez
 * iframe e o `transactionId` programático foi rejeitado por algum motivo),
 * e `ETHERFUSE_ENV=sandbox`, caímos no caminho **mock**: persistimos a
 * order com flag `__mock: true`. `/signing-tx` constrói o burn como um
 * Payment Stellar real (investor → distributor) consumindo TESOURO
 * simbólico — entrega "burn xdr assinado" mesmo sem Etherfuse real.
 *
 * Body: { quoteId }
 * Returns: { orderId, status, mock }
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { AnchorError } from '@/lib/anchors/types';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { sandboxMockAllowed } from '@/lib/env/etherfuse';

export const dynamic = 'force-dynamic';

const Schema = z.object({ quoteId: z.string().min(1).max(60) }).strict();

function isBankAccountMissingError(err: unknown): boolean {
  if (!(err instanceof AnchorError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('proxy account') || msg.includes('bank account');
}

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { quoteId } = Schema.parse(await req.json());

  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { investidor: true, offRampOrder: true },
  });
  if (!quote) {
    throw new ApiError('NOT_FOUND', 404, 'quote não encontrado');
  }
  if (quote.investidorId !== user.investidorId) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'quote não pertence ao investidor autenticado',
    );
  }
  if (quote.fromCurrency !== 'TESOURO' || quote.toCurrency !== 'BRL') {
    throw new ApiError(
      'VALIDATION_FAILED',
      400,
      `quote inválido pra off-ramp: ${quote.fromCurrency} → ${quote.toCurrency}`,
    );
  }
  if (quote.consumedAt) {
    throw new ApiError('CONFLICT', 409, 'quote já consumido');
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('GONE', 410, 'quote expirado');
  }
  if (quote.offRampOrder) {
    return ok(
      {
        orderId: quote.offRampOrder.id,
        status: quote.offRampOrder.status,
        mock: !!(
          quote.offRampOrder.fiatInstructionsJson as Record<
            string,
            unknown
          > | null
        )?.__mock,
      },
      { requestId },
    );
  }
  if (!quote.investidor.etherfuseCustomerId) {
    throw new ApiError(
      'CONFLICT',
      409,
      'investidor sem etherfuseCustomerId — refaça onboarding',
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

  let orderId: string;
  let status: string;
  let fiatInstructionsJson: Prisma.InputJsonValue;
  let mock = false;

  try {
    // PLINA-MOD-006: bankAccountId persistido em Investidor após
    // /bank-account/register. Fallback pra getFiatAccounts (chamada de
    // rede) pra investidores pré-PR sem o field preenchido.
    let bankAccountId = quote.investidor.etherfuseBankAccountId;
    if (!bankAccountId) {
      const accounts = await anchor.getFiatAccounts(
        quote.investidor.etherfuseCustomerId,
      );
      bankAccountId = accounts[0]?.id ?? null;
    }
    if (!bankAccountId) {
      // Estado de UX real (sem conta bancária) — safe surfaciar como 409.
      throw new ApiError(
        'CONFLICT',
        409,
        'Investidor sem fiat account registrada — chame /bank-account/register primeiro',
      );
    }
    const order = await anchor.createOffRamp({
      customerId: quote.investidor.etherfuseCustomerId,
      quoteId: quote.id,
      stellarAddress: quote.investidor.publicKey,
      fromCurrency: quote.fromCurrency,
      toCurrency: quote.toCurrency,
      amount: quote.fromAmount.toFixed(7),
      fiatAccountId: bankAccountId,
    });
    orderId = order.id;
    status = order.status;
    fiatInstructionsJson = { type: 'pix' } as Prisma.InputJsonValue;
  } catch (err) {
    if (sandboxMockAllowed() && isBankAccountMissingError(err)) {
      // Espelha PLINA-MOD-005 fallback do on-ramp: bank PIX exige iframe
      // (ou MOD-006 transactionId pode falhar em alguma edge). Mock
      // permite E2E sandbox; burn XDR continua sendo tx Stellar REAL
      // (Payment investor → distributor) em /signing-tx.
      orderId = `mock-${crypto.randomUUID()}`;
      status = 'pending';
      fiatInstructionsJson = {
        __mock: true,
        type: 'pix',
        beneficiary: 'Plina Sandbox (mock)',
        amount: quote.fromAmount.toFixed(7),
        currency: 'BRL',
      };
      mock = true;
    } else {
      throw err;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.offRampOrder.create({
      data: {
        id: orderId,
        quoteId: quote.id,
        investidorId: quote.investidorId,
        status,
        fiatInstructionsJson,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'OFFRAMP_CRIADA',
        operador: 'investidor-self-service',
        investidorId: quote.investidorId,
        privyId: user.privyId,
        payloadJson: {
          orderId,
          quoteId: quote.id,
          mock,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return ok({ orderId, status, mock }, { requestId });
});
