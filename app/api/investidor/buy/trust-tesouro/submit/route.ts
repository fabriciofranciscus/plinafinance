/**
 * POST /api/investidor/buy/trust-tesouro/submit
 *
 * Submete trustline TESOURO assinada pelo investor (Privy raw hash).
 * TESOURO da Etherfuse NÃO tem AUTH_REQUIRED — não precisa do issuer
 * autorizar (diferente de PLINARF). Trustline é efetiva imediatamente.
 *
 * Body: { xdr, investorPubkey, signatureHex, investidorId? }
 * Returns: { trustlineTxHash }
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
      xdr?: string;
      investorPubkey?: string;
      signatureHex?: string;
    };
    const { xdr, investorPubkey, signatureHex } = body;
    if (!xdr || !investorPubkey || !signatureHex) {
      return NextResponse.json(
        { error: 'xdr, investorPubkey, signatureHex obrigatórios' },
        { status: 400 },
      );
    }
    if (investorPubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'investorPubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }

    // F-11: idempotente. Trustline TESOURO já persistida → retorna existente.
    const existing = await db.investidor.findUnique({
      where: { id: user.investidorId },
      select: { tesouroTrustlineTxHash: true },
    });
    if (existing?.tesouroTrustlineTxHash) {
      return NextResponse.json({
        trustlineTxHash: existing.tesouroTrustlineTxHash,
        idempotent: true,
      });
    }

    const res = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });

    await db.$transaction(async (tx) => {
      await tx.investidor.update({
        where: { id: user.investidorId },
        data: { tesouroTrustlineTxHash: res.hash },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'TESOURO_TRUSTLINE_AUTORIZADA',
          operador: 'investidor-self-service',
          investidorId: user.investidorId,
          privyId: user.privyId,
          stellarTxHash: res.hash,
          payloadJson: {
            targetPubkey: investorPubkey,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ trustlineTxHash: res.hash });
  } catch (err) {
    logStellarError('[trust-tesouro/submit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
