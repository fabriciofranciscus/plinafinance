/**
 * GET /api/investidor/buy/onramp/status?orderId=...
 *
 * Lê estado da OnRampOrder. Se não terminal e não-mock, faz pull no
 * Etherfuse e atualiza o DB (status + stellarTxHash quando completed).
 * Cliente faz polling enquanto status != completed.
 *
 * Returns: { orderId, status, stellarTxHash, mock, paymentInstructions }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded']);

export const GET = withAuth(async (req, { user }) => {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get('orderId');
    if (!orderId) {
      return NextResponse.json({ error: 'orderId obrigatório' }, { status: 400 });
    }

    const order = await db.onRampOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'order não encontrada' }, { status: 404 });
    }
    if (order.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'order não pertence ao investidor autenticado' },
        { status: 403 },
      );
    }

    const instructions = order.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    const mock = instructions?.__mock === true;

    // Mock orders nunca consultam Etherfuse — flips só via /sandbox-pay.
    if (mock || TERMINAL.has(order.status)) {
      return NextResponse.json({
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        stellarClaimableBalanceId: order.stellarClaimableBalanceId,
        claimTxHash: order.claimTxHash,
        mock,
        paymentInstructions: instructions,
      });
    }

    // Real: pull no Etherfuse + atualiza DB se mudou.
    const apiKey = process.env.ETHERFUSE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ETHERFUSE_API_KEY ausente' },
        { status: 500 },
      );
    }
    const anchor = new EtherfuseClient({
      apiKey,
      baseUrl:
        process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
    });

    const remote = await anchor.getOnRampTransaction(orderId);
    if (!remote) {
      // Etherfuse ainda indexando (PLINA-MOD-004) — devolve o que temos.
      return NextResponse.json({
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        mock,
        paymentInstructions: instructions,
        indexing: true,
      });
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

    return NextResponse.json({
      orderId: order.id,
      status: newStatus,
      stellarTxHash: newTxHash,
      stellarClaimableBalanceId: newCbId,
      claimTxHash: order.claimTxHash,
      mock: false,
      paymentInstructions: instructions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
