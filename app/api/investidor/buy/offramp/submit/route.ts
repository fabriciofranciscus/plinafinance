/**
 * POST /api/investidor/buy/offramp/submit
 *
 * Submete o burn XDR assinado via Privy. Real path = burnTransaction da
 * Etherfuse; mock path = Payment investor → distributor (TESOURO simbólico
 * queimado em Stellar real). Em ambos os casos, o hash retornado é uma tx
 * Stellar real e auditável em testnet.
 *
 * Idempotente: se `order.burnStellarTxHash` já existe, devolve direto.
 *
 * Body: { orderId, xdr, signatureHex }
 * Returns: { burnStellarTxHash, mock }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { withAuth } from '@/lib/wallet/auth-guard';
import { logStellarError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = (await req.json()) as {
      orderId?: string;
      xdr?: string;
      signatureHex?: string;
    };
    const { orderId, xdr, signatureHex } = body;
    if (!orderId || !xdr || !signatureHex) {
      return NextResponse.json(
        { error: 'orderId, xdr, signatureHex obrigatórios' },
        { status: 400 },
      );
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
    if (order.status !== 'signable_ready' && !order.burnStellarTxHash) {
      return NextResponse.json(
        { error: `order em status ${order.status} — chame /signing-tx primeiro` },
        { status: 409 },
      );
    }

    const mock =
      (order.fiatInstructionsJson as Record<string, unknown> | null)?.__mock ===
      true;

    // Idempotência.
    if (order.burnStellarTxHash) {
      return NextResponse.json({
        burnStellarTxHash: order.burnStellarTxHash,
        mock,
      });
    }

    const res = await submitWithPrivySignature({
      xdr,
      investorPubkey: user.publicKey,
      investorSignatureHex: signatureHex,
    });

    await db.$transaction(async (tx) => {
      await tx.offRampOrder.update({
        where: { id: order.id },
        data: {
          status: 'submitted',
          burnStellarTxHash: res.hash,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'OFFRAMP_BURN_ASSINADO',
          operador: mock ? 'sandbox-mock' : 'etherfuse-anchor',
          investidorId: order.investidorId,
          privyId: user.privyId,
          stellarTxHash: res.hash,
          payloadJson: {
            orderId: order.id,
            burnStellarTxHash: res.hash,
            mock,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ burnStellarTxHash: res.hash, mock });
  } catch (err) {
    logStellarError('[offramp/submit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
