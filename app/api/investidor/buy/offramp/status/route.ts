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

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req, { user }) => {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');
    if (!orderId) {
      return NextResponse.json({ error: 'orderId obrigatório' }, { status: 400 });
    }

    const order = await db.offRampOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'order não encontrada' }, { status: 404 });
    }
    if (order.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'order não pertence ao investidor autenticado' },
        { status: 403 },
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

    return NextResponse.json({
      status: newStatus,
      burnStellarTxHash: order.burnStellarTxHash,
      settledAt,
      mock,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
