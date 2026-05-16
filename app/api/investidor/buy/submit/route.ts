/**
 * POST /api/investidor/buy/submit
 *
 * Recebe trustline XDR assinada pelo investor (via Privy), submete, autoriza
 * server-side, e distribui PLINARF. Atualiza saldoEsperado no Investidor.
 *
 * Sequência on-chain:
 *   1. submit(trustlineXdr + investor signature)
 *   2. authorizeTrustline(issuer signs server-side)
 *   3. distribute(distributor → investor, N PLINARF)
 *
 * Audit log dual: TRUSTLINE_AUTORIZADA + DISTRIBUICAO.
 *
 * Body: { xdr, investorPubkey, signatureHex, amount, investidorId? }
 * Returns: { trustlineTxHash, distributeTxHash }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { distribute } from '@/lib/stellar/issuer';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      xdr?: string;
      investorPubkey?: string;
      signatureHex?: string;
      amount?: string;
      investidorId?: string;
    };
    const { xdr, investorPubkey, signatureHex, amount, investidorId } = body;
    if (!xdr || !investorPubkey || !signatureHex || !amount) {
      return NextResponse.json(
        { error: 'xdr, investorPubkey, signatureHex, amount obrigatórios' },
        { status: 400 },
      );
    }

    // Stellar amounts: máx 7 decimais. Etherfuse retorna `toAmount` com até
    // 20 decimais (precisão interna). Truncate pro formato aceito on-chain.
    const amountNum = Number(amount);
    if (!isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: 'amount inválido (deve ser > 0)' },
        { status: 400 },
      );
    }
    const stellarAmount = amountNum.toFixed(7);

    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    const distributorSecret = process.env.STELLAR_DISTRIBUTOR_SECRET;
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    if (!issuerSecret || !distributorSecret || !issuerPubkey) {
      return NextResponse.json(
        { error: 'Stellar issuer/distributor não configurados' },
        { status: 500 },
      );
    }

    // 1) Submete trustline assinada pelo investor.
    const trustlineRes = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });

    // 2) Issuer autoriza trustline (server-side).
    const authRes = await authorizeTrustline(issuerSecret, investorPubkey);

    // 3) Distributor paga PLINARF pro investor (server-side).
    const distRes = await distribute(
      distributorSecret,
      issuerPubkey,
      investorPubkey,
      stellarAmount,
    );

    // 4) Audit log + atualização do investidor (se conhecido).
    if (investidorId) {
      await db.$transaction(async (tx) => {
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
        await tx.eventoAudit.create({
          data: {
            acao: 'DISTRIBUICAO',
            operador: 'investidor-self-service',
            investidorId,
            stellarTxHash: distRes.hash,
            payloadJson: {
              amount: stellarAmount,
              targetPubkey: investorPubkey,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.investidor.update({
          where: { id: investidorId },
          data: {
            trustlineTxHash: trustlineRes.hash,
            saldoEsperado: {
              increment: new Prisma.Decimal(stellarAmount),
            },
          },
        });
      });
    }

    return NextResponse.json({
      trustlineTxHash: trustlineRes.hash,
      authorizeTxHash: authRes.hash,
      distributeTxHash: distRes.hash,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
