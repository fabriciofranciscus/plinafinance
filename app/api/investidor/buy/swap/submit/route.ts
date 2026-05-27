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
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { withAuth } from '@/lib/wallet/auth-guard';
import { logStellarError } from '@/lib/stellar/log-error';
import { parseBody } from '@/lib/http/parse-body';
import {
  stellarPubkey,
  stellarSignatureHex,
  stellarXdr,
} from '@/lib/http/zod-stellar';
import { parseStellarAmount } from '@/lib/format/parse-stellar-amount';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    quoteId: z.string().min(1).max(60),
    investorPubkey: stellarPubkey(),
    signatureHex: stellarSignatureHex(),
    xdr: stellarXdr(),
    distributorSigBase64: z.string().min(1).max(256),
    distributorPubkey: stellarPubkey(),
    investidorId: z.string().min(1).max(60).optional(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const {
    quoteId,
    investorPubkey,
    signatureHex,
    xdr,
    distributorSigBase64,
    distributorPubkey,
    investidorId,
  } = parsed.data;
  try {
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
    // C-04: idempotência. xdrHash reserva a request; retry com mesmo XDR
    // após sucesso retorna hash existente, com XDR diferente em quote já
    // lacrado retorna 409.
    const xdrHash = createHash('sha256').update(xdr).digest('hex');
    if (quote.consumedAt) {
      if (quote.submitXdrHash === xdrHash && quote.consumedTxHash) {
        logStellarError(
          '[swap/submit] idempotente (já consumido)',
          new Error('retry pós sucesso'),
        );
        return NextResponse.json({
          swapTxHash: quote.consumedTxHash,
          idempotent: true,
        });
      }
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

    // C-01: valida que a XDR assinada bate com o quote server-side.
    // Sem isso, signature em rawSign não amarra amount/asset/destinos.
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    if (!issuerPubkey) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_PUBLIC ausente' },
        { status: 500 },
      );
    }
    const expectedAmount = parseStellarAmount(quote.toAmount).toFixed(7);
    const tesouro = await resolveTesouroAsset(investorPubkey);
    try {
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey,
        distributorPubkey,
        issuerPubkey,
        bridgeAsset: { code: tesouro.code, issuer: tesouro.issuer },
        expectedAmount,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `xdr divergente do quote: ${err instanceof Error ? err.message : 'unknown'}`,
        },
        { status: 400 },
      );
    }

    // C-04: reserva o xdrHash ANTES do submit. Race window de 2 chamadas
    // simultâneas: a primeira ganha (count=1), a segunda 409.
    const reserved = await db.quote.updateMany({
      where: { id: quote.id, submitXdrHash: null },
      data: { submitXdrHash: xdrHash },
    });
    if (reserved.count !== 1) {
      const fresh = await db.quote.findUnique({
        where: { id: quote.id },
        select: { submitXdrHash: true, consumedTxHash: true },
      });
      if (fresh?.submitXdrHash === xdrHash && fresh.consumedTxHash) {
        return NextResponse.json({
          swapTxHash: fresh.consumedTxHash,
          idempotent: true,
        });
      }
      return NextResponse.json(
        { error: 'quote já em flight com outra XDR' },
        { status: 409 },
      );
    }

    const submitRes = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
      extraSignatures: [
        { pubkey: distributorPubkey, sigBase64: distributorSigBase64 },
      ],
    });

    const stellarAmount = expectedAmount;

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
