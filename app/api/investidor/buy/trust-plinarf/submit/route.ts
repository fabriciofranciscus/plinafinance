/**
 * POST /api/investidor/buy/trust-plinarf/submit
 *
 * Submete trustline PLINARF assinada pelo investor + issuer autoriza
 * server-side. NÃO emite tokens — emissão é separada via /buy/swap após
 * onramp settled (Phase 2). Setup one-time idempotente.
 *
 * Body: { xdr, investorPubkey, signatureHex, investidorId? }
 * Returns: { trustlineTxHash, authorizeTxHash }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      xdr?: string;
      investorPubkey?: string;
      signatureHex?: string;
      investidorId?: string;
    };
    const { xdr, investorPubkey, signatureHex, investidorId } = body;
    if (!xdr || !investorPubkey || !signatureHex) {
      return NextResponse.json(
        { error: 'xdr, investorPubkey, signatureHex obrigatórios' },
        { status: 400 },
      );
    }

    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    if (!issuerSecret) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_SECRET ausente' },
        { status: 500 },
      );
    }

    await assertElegivelParaTrustline({
      investidorId,
      publicKey: investorPubkey,
    });

    const trustlineRes = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });

    const authRes = await authorizeTrustline(issuerSecret, investorPubkey);

    if (investidorId) {
      await db.$transaction(async (tx) => {
        await tx.investidor.update({
          where: { id: investidorId },
          data: { trustlineTxHash: trustlineRes.hash },
        });
        await tx.eventoAudit.create({
          data: {
            acao: 'TRUSTLINE_AUTORIZADA',
            operador: 'investidor-self-service',
            investidorId,
            stellarTxHash: authRes.hash,
            payloadJson: {
              trustlineTxHash: trustlineRes.hash,
            } as Prisma.InputJsonValue,
          },
        });
      });
    }

    return NextResponse.json({
      trustlineTxHash: trustlineRes.hash,
      authorizeTxHash: authRes.hash,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
