/**
 * GET /api/investidor/buy/onramp/status?orderId=...
 *
 * Lê estado da OnRampOrder. Se não terminal e não-mock, faz pull no
 * Etherfuse e atualiza o DB (status + stellarTxHash quando completed).
 * Cliente faz polling enquanto status != completed.
 *
 * Returns: { orderId, status, stellarTxHash, mock, paymentInstructions }
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded']);

export const GET = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const url = new URL(req.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) {
    throw new ApiError('VALIDATION_FAILED', 400, 'orderId obrigatório');
  }

  const order = await db.onRampOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError('NOT_FOUND', 404, 'order não encontrada');
  }
  if (order.investidorId !== user.investidorId) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'order não pertence ao investidor autenticado',
    );
  }

  const instructions = order.paymentInstructionsJson as
    | (Record<string, unknown> & { __mock?: boolean })
    | null;
  const mock = instructions?.__mock === true;

  // Mock orders nunca consultam Etherfuse — flips só via /sandbox-pay.
  if (mock || TERMINAL.has(order.status)) {
    return ok(
      {
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        stellarClaimableBalanceId: order.stellarClaimableBalanceId,
        claimTxHash: order.claimTxHash,
        mock,
        paymentInstructions: instructions,
      },
      { requestId },
    );
  }

  // Real: pull no Etherfuse + atualiza DB se mudou.
  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('ETHERFUSE_API_KEY ausente');
  }
  const anchor = new EtherfuseClient({
    apiKey,
    baseUrl:
      process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });

  const remote = await anchor.getOnRampTransaction(orderId);
  if (!remote) {
    // Etherfuse ainda indexando (PLINA-MOD-004) — devolve o que temos.
    return ok(
      {
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        mock,
        paymentInstructions: instructions,
        indexing: true,
      },
      { requestId },
    );
  }

  const newStatus = remote.status;
  const newTxHash = remote.stellarTxHash ?? null;
  const newCbId =
    remote.stellarClaimableBalanceId ?? order.stellarClaimableBalanceId;
  const changed =
    newStatus !== order.status ||
    newTxHash !== order.stellarTxHash ||
    newCbId !== order.stellarClaimableBalanceId;

  if (changed) {
    const settledNow = newStatus === 'completed' && !order.settledAt;
    await db.$transaction(async (tx) => {
      await tx.onRampOrder.update({
        where: { id: order.id },
        data: {
          status: newStatus,
          stellarTxHash: newTxHash,
          stellarClaimableBalanceId: newCbId,
          settledAt: settledNow ? new Date() : order.settledAt,
        },
      });
      if (settledNow) {
        await tx.eventoAudit.create({
          data: {
            acao: 'ONRAMP_LIQUIDADA',
            operador: 'etherfuse-anchor',
            investidorId: order.investidorId,
            privyId: user.privyId,
            stellarTxHash: newTxHash ?? undefined,
            payloadJson: {
              orderId: order.id,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  return ok(
    {
      orderId: order.id,
      status: newStatus,
      stellarTxHash: newTxHash,
      stellarClaimableBalanceId: newCbId,
      claimTxHash: order.claimTxHash,
      mock: false,
      paymentInstructions: instructions,
    },
    { requestId },
  );
});
