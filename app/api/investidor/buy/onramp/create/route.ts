/**
 * POST /api/investidor/buy/onramp/create
 *
 * Cria uma order de onramp BRL → TESOURO na Etherfuse, persistida como
 * `OnRampOrder` no DB e atada ao `Quote` (1:1). PIX instructions são
 * devolvidas pro investor pagar off-chain.
 *
 * Quando a Etherfuse rejeita por "Proxy account not found" (PLINA-MOD-005:
 * sandbox sem bank account ativa via iframe), e `ETHERFUSE_ENV=sandbox`,
 * caímos no caminho **mock**: persistimos a order com PIX fake e marcamos
 * `__mock: true` no JSON. /sandbox-pay e /swap/build conhecem esse flag.
 *
 * Body: { quoteId }
 * Returns: { orderId, status, paymentInstructions, mock }
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
import { mainnetCutoverGuard } from '@/lib/env/feature-gates';
import { sandboxMockAllowed } from '@/lib/env/etherfuse';

export const dynamic = 'force-dynamic';

const Schema = z.object({ quoteId: z.string().min(1).max(60) }).strict();

const MOCK_PIX_KEY = 'plina-sandbox@mock.local';

function isBankAccountMissingError(err: unknown): boolean {
  if (!(err instanceof AnchorError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('proxy account') || msg.includes('bank account');
}

export const POST = withApi(async (req, { requestId }) => {
  // Guard de cutover devolve NextResponse cru — passa direto pelo withApi.
  const cutover = await mainnetCutoverGuard();
  if (cutover) return cutover;

  const user = await requireInvestidor(req);
  const { quoteId } = Schema.parse(await req.json());

  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { investidor: true, onRampOrder: true },
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
  if (quote.consumedAt) {
    throw new ApiError('CONFLICT', 409, 'quote já consumido');
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('GONE', 410, 'quote expirado');
  }
  if (quote.onRampOrder) {
    // Idempotência: order já existe pra esse quote, devolve.
    const instructions = quote.onRampOrder.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    return ok(
      {
        orderId: quote.onRampOrder.id,
        status: quote.onRampOrder.status,
        paymentInstructions: instructions,
        mock: instructions?.__mock === true,
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
  let paymentInstructionsJson: Prisma.InputJsonValue;
  let mock = false;

  try {
    const order = await anchor.createOnRamp({
      customerId: quote.investidor.etherfuseCustomerId,
      quoteId: quote.id,
      stellarAddress: quote.investidor.publicKey,
      fromCurrency: quote.fromCurrency,
      toCurrency: quote.toCurrency,
      amount: quote.fromAmount.toFixed(2),
    });
    orderId = order.id;
    status = order.status;
    paymentInstructionsJson = (order.paymentInstructions ??
      {}) as Prisma.InputJsonValue;
  } catch (err) {
    if (sandboxMockAllowed() && isBankAccountMissingError(err)) {
      // PLINA-MOD-005: bank account PIX exige iframe Etherfuse, indisponível
      // em testes programáticos. Mock só pra desbloquear E2E sandbox.
      orderId = `mock-${crypto.randomUUID()}`;
      status = 'pending';
      paymentInstructionsJson = {
        __mock: true,
        type: 'pix',
        pixCode: MOCK_PIX_KEY,
        pixKey: MOCK_PIX_KEY,
        pixKeyType: 'email',
        beneficiary: 'Plina Sandbox (mock)',
        amount: quote.fromAmount.toFixed(2),
        currency: 'BRL',
      };
      mock = true;
    } else {
      throw err;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.onRampOrder.create({
      data: {
        id: orderId,
        quoteId: quote.id,
        investidorId: quote.investidorId,
        status,
        paymentInstructionsJson,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'ONRAMP_CRIADA',
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

  return ok(
    {
      orderId,
      status,
      paymentInstructions: paymentInstructionsJson,
      mock,
    },
    { requestId },
  );
});
