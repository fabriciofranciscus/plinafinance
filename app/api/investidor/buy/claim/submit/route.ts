/**
 * POST /api/investidor/buy/claim/submit
 *
 * Submete o XDR de `claimClaimableBalance` assinado via Privy. Move TESOURO
 * do ClaimableBalance pra trustline do investor — pré-req pro off-ramp burn
 * funcionar (op_underfunded sem isso).
 *
 * Idempotente: se `OnRampOrder.claimTxHash` já existe, retorna direto.
 *
 * Body: { orderId, xdr, signatureHex }
 * Returns: { claimTxHash, idempotent? }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { logStellarError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    orderId: z.string().min(1).max(60),
    xdr: z.string().min(1).max(8192),
    signatureHex: z.string().min(1).max(256),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { orderId, xdr, signatureHex } = parsed.data;
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

    // Idempotência.
    if (order.claimTxHash) {
      return NextResponse.json({
        claimTxHash: order.claimTxHash,
        idempotent: true,
      });
    }

    const res = await submitWithPrivySignature({
      xdr,
      investorPubkey: user.publicKey,
      investorSignatureHex: signatureHex,
    });

    await db.$transaction(async (tx) => {
      await tx.onRampOrder.update({
        where: { id: order.id },
        data: { claimTxHash: res.hash },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'CLAIMABLE_BALANCE_RESGATADA',
          operador: 'investidor-self-service',
          investidorId: order.investidorId,
          privyId: user.privyId,
          stellarTxHash: res.hash,
          payloadJson: {
            orderId: order.id,
            balanceId: order.stellarClaimableBalanceId,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ claimTxHash: res.hash });
  } catch (err) {
    logStellarError('[claim/submit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
