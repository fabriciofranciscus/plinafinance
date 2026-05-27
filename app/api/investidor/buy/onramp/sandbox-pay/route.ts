/**
 * POST /api/investidor/buy/onramp/sandbox-pay
 *
 * **Sandbox/dev only.** Simula o pagamento PIX que o investor faria
 * off-chain — pra E2E rodar sem operador humano. Em produção essa rota é
 * 403.
 *
 * Comportamento:
 *   - Order real: chama Etherfuse `simulateFiatReceived` + poll. Atualiza
 *     status + stellarTxHash quando completed.
 *   - Order mock (PLINA-MOD-005 bypass): flipa status=completed +
 *     `stellarTxHash = mock-<orderId>`. Não há tx Stellar real.
 *
 * Body: { orderId }
 * Returns: { status, stellarTxHash, mock }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { getAssetBalance } from '@/lib/stellar/account';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';

export const dynamic = 'force-dynamic';

const Schema = z.object({ orderId: z.string().min(1).max(60) }).strict();

export const POST = withAuth(async (req, { user }) => {
  const env = process.env.ETHERFUSE_ENV ?? 'sandbox';
  if (env === 'production') {
    return NextResponse.json(
      { error: 'sandbox-pay desabilitado em produção' },
      { status: 403 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { orderId } = parsed.data;
  try {
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
    if (order.status === 'completed') {
      return NextResponse.json({
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        mock: !!(order.paymentInstructionsJson as Record<string, unknown> | null)?.__mock,
      });
    }

    const instructions = order.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    const mock = instructions?.__mock === true;

    let finalStatus = order.status;
    let finalTxHash = order.stellarTxHash;
    let claimableBalanceId: string | null = order.stellarClaimableBalanceId;

    if (mock) {
      finalStatus = 'completed';
      finalTxHash = `mock-stellar-${order.id}`;
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

      await anchor.simulateFiatReceived(order.id);
      // PIX/BRL sandbox às vezes para em `funded` (= processing) sem auto-completar
      // pra `completed`. Doutrina demo quirk #7. Aceito como terminal — anchor já
      // confirmou o pagamento e a CB pode ser claimed pelo investor mesmo assim.
      const terminal = await anchor.pollOnRampUntilTerminal(order.id, {
        intervalMs: 2_000,
        timeoutMs: 120_000,
        acceptProcessing: true,
      });
      finalStatus = terminal.status;
      finalTxHash = terminal.stellarTxHash ?? null;
      // PLINA-MOD-007: anchor pode emitir ClaimableBalance em vez de payment.
      // Persiste pro /buy/claim/build consumir depois.
      if (terminal.stellarClaimableBalanceId) {
        claimableBalanceId = terminal.stellarClaimableBalanceId;
      }
    }

    await db.$transaction(async (tx) => {
      await tx.onRampOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          stellarTxHash: finalTxHash,
          stellarClaimableBalanceId: claimableBalanceId,
          settledAt: finalStatus === 'completed' ? new Date() : null,
        },
      });
      if (finalStatus === 'completed') {
        await tx.eventoAudit.create({
          data: {
            acao: 'ONRAMP_LIQUIDADA',
            operador: mock ? 'sandbox-mock' : 'etherfuse-anchor',
            investidorId: order.investidorId,
            privyId: user.privyId,
            stellarTxHash: finalTxHash ?? undefined,
            payloadJson: {
              orderId: order.id,
              mock,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });

    let tesouroBalanceAfterMint: string | null = null;
    if (!mock && finalStatus === 'completed') {
      try {
        const investidor = await db.investidor.findUnique({
          where: { id: order.investidorId },
          select: { publicKey: true },
        });
        if (investidor) {
          const tesouro = await resolveTesouroAsset(investidor.publicKey);
          tesouroBalanceAfterMint = await getAssetBalance(
            investidor.publicKey,
            tesouro.code,
            tesouro.issuer,
          );
        }
      } catch (balanceErr) {
        // read-back é diagnóstico; não falha o request se Horizon recusar
        console.warn('[sandbox-pay] getAssetBalance falhou:', balanceErr);
      }
    }

    return NextResponse.json({
      status: finalStatus,
      stellarTxHash: finalTxHash,
      stellarClaimableBalanceId: claimableBalanceId,
      mock,
      tesouroBalanceAfterMint,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
