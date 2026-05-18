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

    const res = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });

    // Resolve investidorId via pubkey se não foi enviado.
    const investidor = investidorId
      ? await db.investidor.findUnique({ where: { id: investidorId } })
      : await db.investidor.findUnique({ where: { publicKey: investorPubkey } });

    if (investidor) {
      await db.$transaction(async (tx) => {
        await tx.investidor.update({
          where: { id: investidor.id },
          data: { tesouroTrustlineTxHash: res.hash },
        });
        await tx.eventoAudit.create({
          data: {
            acao: 'TESOURO_TRUSTLINE_AUTORIZADA',
            operador: 'investidor-self-service',
            investidorId: investidor.id,
            stellarTxHash: res.hash,
            payloadJson: {
              targetPubkey: investorPubkey,
            } as Prisma.InputJsonValue,
          },
        });
      });
    }

    return NextResponse.json({ trustlineTxHash: res.hash });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
