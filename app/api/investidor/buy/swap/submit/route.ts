/**
 * POST /api/investidor/buy/swap/submit
 *
 * Recebe a signature do investor sobre o envelope swap (TESOURO → distributor
 * + PLINARF → investor) e a signature pré-assinada do distributor; submete
 * a tx atômica. Atomicidade: ambas legs commitam juntas — se TESOURO leg
 * underfundar, PLINARF leg não executa.
 *
 * Marca o quote como consumido dentro da mesma db.$transaction do audit log.
 * Modo mock é tratado em /swap/build — esta rota só aceita real.
 *
 * Body: { quoteId, investorPubkey, signatureHex, xdr, distributorSigBase64, distributorPubkey, investidorId? }
 * Returns: { swapTxHash }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { withAuth } from '@/lib/wallet/auth-guard';
import { logStellarError } from '@/lib/stellar/log-error';
import { parseStellarAmount } from '@/lib/format/parse-stellar-amount';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = (await req.json()) as {
      quoteId?: string;
      investorPubkey?: string;
      signatureHex?: string;
      xdr?: string;
      distributorSigBase64?: string;
      distributorPubkey?: string;
      investidorId?: string;
    };
    const {
      quoteId,
      investorPubkey,
      signatureHex,
      xdr,
      distributorSigBase64,
      distributorPubkey,
      investidorId,
    } = body;
    if (
      !quoteId ||
      !investorPubkey ||
      !signatureHex ||
      !xdr ||
      !distributorSigBase64 ||
      !distributorPubkey
    ) {
      return NextResponse.json(
        {
          error:
            'quoteId, investorPubkey, signatureHex, xdr, distributorSigBase64, distributorPubkey obrigatórios',
        },
        { status: 400 },
      );
    }
    if (user.publicKey !== investorPubkey) {
      return NextResponse.json(
        { error: 'investorPubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }

    const quote = await db.quote.findUnique({
      where: { id: quoteId },
      include: { investidor: true, onRampOrder: true },
    });
    if (!quote) {
      return NextResponse.json({ error: 'quote não encontrado' }, { status: 404 });
    }
    if (quote.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'quote pertence a outro investidor' },
        { status: 403 },
      );
    }
    if (investidorId && quote.investidorId !== investidorId) {
      return NextResponse.json(
        { error: 'investidorId não bate com o quote' },
        { status: 403 },
      );
    }
    if (quote.consumedAt) {
      return NextResponse.json({ error: 'quote já consumido' }, { status: 409 });
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'quote expirado' }, { status: 410 });
    }
    const onRampOrder = quote.onRampOrder;
    if (!onRampOrder || onRampOrder.status !== 'completed') {
      return NextResponse.json(
        { error: 'onramp não está em status completed' },
        { status: 409 },
      );
    }

    const instructions = onRampOrder.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    if (instructions?.__mock === true) {
      return NextResponse.json(
        { error: 'swap mock já foi executado em /swap/build' },
        { status: 409 },
      );
    }

    await assertElegivelParaTrustline({
      investidorId: quote.investidorId,
      publicKey: investorPubkey,
    });

    const submitRes = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
      extraSignatures: [
        { pubkey: distributorPubkey, sigBase64: distributorSigBase64 },
      ],
    });

    const stellarAmount = parseStellarAmount(quote.toAmount).toFixed(7);

    await db.$transaction(async (tx) => {
      const consumed = await tx.quote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: {
          consumedAt: new Date(),
          consumedTxHash: submitRes.hash,
        },
      });
      if (consumed.count !== 1) {
        throw new Error('quote consumido concorrentemente — abortando');
      }
      await tx.investidor.update({
        where: { id: quote.investidorId },
        data: {
          saldoEsperado: {
            increment: new Prisma.Decimal(stellarAmount),
          },
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'SWAP_EXECUTADO',
          operador: 'investidor-self-service',
          investidorId: quote.investidorId,
          privyId: user.privyId,
          stellarTxHash: submitRes.hash,
          payloadJson: {
            quoteId: quote.id,
            orderId: onRampOrder.id,
            amount: stellarAmount,
            mock: false,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ swapTxHash: submitRes.hash });
  } catch (err) {
    logStellarError('[swap/submit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
