/**
 * GET /api/investidor/buy/offramp/status?orderId=...
 *
 * Polled pelo cliente. Atualiza o DB se Etherfuse moveu o estado.
 *
 *   - Mock path: status flipa direto `submitted → processing` (sandbox PIX
 *     não auto-completa pra real; processing é terminal aceito).
 *   - Real path: chama `anchor.getOffRampTransaction(orderId)`. Mapping da
 *     lib retorna `processing` quando Etherfuse raw = `funded` (burn
 *     confirmado on-chain). Audit `OFFRAMP_PROCESSANDO` emitido na primeira
 *     transição.
 *
 * Query: orderId
 * Returns: { status, burnStellarTxHash, settledAt }
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get('orderId');
  if (!orderId) {
    throw new ApiError('VALIDATION_FAILED', 400, 'orderId obrigatório');
  }

  const order = await db.offRampOrder.findUnique({ where: { id: orderId } });
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

  const mock =
    (order.fiatInstructionsJson as Record<string, unknown> | null)?.__mock ===
    true;

  let newStatus = order.status;
  let settledAt = order.settledAt;
  let transitioned = false;

  if (mock) {
    if (order.status === 'submitted') {
      newStatus = 'processing';
      settledAt = new Date();
      transitioned = true;
    }
  } else {
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

    const remote = await anchor.getOffRampTransaction(order.id);
    if (remote && remote.status !== order.status) {
      newStatus = remote.status;
      if (newStatus === 'processing' || newStatus === 'completed') {
        settledAt = settledAt ?? new Date();
      }
      transitioned = order.status !== 'processing' && newStatus === 'processing';
    }
  }

  if (newStatus !== order.status || transitioned) {
    await db.$transaction(async (tx) => {
      await tx.offRampOrder.update({
        where: { id: order.id },
        data: { status: newStatus, settledAt },
      });
      if (transitioned) {
        await tx.eventoAudit.create({
          data: {
            acao: 'OFFRAMP_PROCESSANDO',
            operador: mock ? 'sandbox-mock' : 'etherfuse-anchor',
            investidorId: order.investidorId,
            privyId: user.privyId,
            stellarTxHash: order.burnStellarTxHash ?? undefined,
            payloadJson: {
              orderId: order.id,
              mock,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  return ok(
    {
      status: newStatus,
      burnStellarTxHash: order.burnStellarTxHash,
      settledAt,
      mock,
    },
    { requestId },
  );
});
