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
import {
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
} from '@/lib/stellar/transactions';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { withAuth } from '@/lib/wallet/auth-guard';
import { extractSafeError, logStellarError } from '@/lib/stellar/log-error';
import { parseBody } from '@/lib/http/parse-body';
import {
  stellarPubkey,
  stellarSignatureHex,
  stellarXdr,
} from '@/lib/http/zod-stellar';
import { parseStellarAmount } from '@/lib/format/parse-stellar-amount';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';
import { incrementarHolding } from '@/lib/services/holdings';
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
    // Validade da cotação FX só vale ANTES do pagamento. Pós-settlement
    // (onramp completed) a swap é 1:1 NAV; não bloqueia por expiração — o
    // settlement/claim/assinatura levam mais que o TTL de 60s do quote.
    const onRampOrder = quote.onRampOrder;
    const onrampCompleted = onRampOrder?.status === 'completed';
    if (!onrampCompleted && quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'quote expirado' }, { status: 410 });
    }
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
    const classe = classeOrDefault(quote.classe);
    const plinarfCode = assetCodeForClasse(classe);
    const tesouro = await resolveTesouroAsset(investorPubkey);
    try {
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey,
        distributorPubkey,
        issuerPubkey,
        bridgeAsset: { code: tesouro.code, issuer: tesouro.issuer },
        expectedAmount,
        plinarfCode,
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
        select: { submitXdrHash: true, consumedTxHash: true, consumedAt: true },
      });
      // Já totalmente escriturado → idempotente.
      if (fresh?.consumedAt && fresh.submitXdrHash === xdrHash && fresh.consumedTxHash) {
        return NextResponse.json({
          swapTxHash: fresh.consumedTxHash,
          idempotent: true,
        });
      }
      // Reservado por OUTRA xdr → 409 real.
      if (fresh?.submitXdrHash !== xdrHash) {
        return NextResponse.json(
          { error: 'quote já em flight com outra XDR' },
          { status: 409 },
        );
      }
      // Mesma xdr, sem consumedAt → reserva órfã: o submit pode ter mintado
      // on-chain mas o commit no DB morreu no meio. NÃO trava em 409 — cai no
      // fluxo de submit-or-reconcile abaixo, que checa a chain antes de agir.
    }

    // Fecha a janela de crash: numa reserva nova (count===1) a tx ainda não foi
    // submetida; numa reserva órfã (recovery), o hash é determinístico a partir
    // da XDR, então consultamos o Horizon — se a tx já está on-chain com sucesso,
    // os tokens já foram mintados e só falta escriturar (sem re-submeter).
    const expectedTxHash = txHashFromXdr(xdr);
    const onchain =
      reserved.count === 1 ? null : await fetchTransactionByHash(expectedTxHash);

    let finalHash: string;
    if (onchain?.successful) {
      finalHash = onchain.hash;
    } else if (onchain && !onchain.successful) {
      return NextResponse.json(
        { error: 'tx anterior falhou on-chain — refaça o swap (rebuild)' },
        { status: 409 },
      );
    } else {
      const submitRes = await submitWithPrivySignature({
        xdr,
        investorPubkey,
        investorSignatureHex: signatureHex,
        extraSignatures: [
          { pubkey: distributorPubkey, sigBase64: distributorSigBase64 },
        ],
      });
      finalHash = submitRes.hash;
    }

    const stellarAmount = expectedAmount;

    await db.$transaction(async (tx) => {
      const consumed = await tx.quote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: {
          consumedAt: new Date(),
          consumedTxHash: finalHash,
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
      await incrementarHolding(tx, {
        investidorId: quote.investidorId,
        classe,
        amount: stellarAmount,
        txHash: finalHash,
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'SWAP_EXECUTADO',
          operador: 'investidor-self-service',
          investidorId: quote.investidorId,
          privyId: user.privyId,
          stellarTxHash: finalHash,
          payloadJson: {
            quoteId: quote.id,
            orderId: onRampOrder.id,
            amount: stellarAmount,
            classe,
            assetCode: plinarfCode,
            mock: false,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ swapTxHash: finalHash });
  } catch (err) {
    logStellarError('[swap/submit]', err);
    // Surfacing dos result_codes do Horizon (tx_/op_*) no corpo — sem eles, o
    // err.message do SDK é genérico ("Request failed with status code 400") e
    // o motivo real (op_underfunded, op_no_trust, tx_bad_auth…) fica só no log.
    const safe = extractSafeError(err);
    return NextResponse.json(
      {
        error: safe.message ?? 'unknown',
        title: safe.title,
        resultCodes: safe.result_codes,
      },
      { status: 500 },
    );
  }
});
