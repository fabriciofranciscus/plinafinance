/**
 * POST /api/investidor/quote
 *
 * Quote BRL → TESOURO via Etherfuse (real). Plina white-label exibe pro
 * investidor o quote da anchor antes de "comprar PLINA-RF".
 *
 * Persiste o quote no DB (`Quote`) pra binding server-side de valor em
 * /buy/swap/{build,submit}. Sem isso, a emissão aceitaria `amount` arbitrário
 * do body → emissão arbitrária de PLINARF (gap fechado 2026-05-18 com
 * Phase 1; Phase 2 fechou doutrinariamente com swap atômico).
 *
 * Body: { amountBrl: string, customerId: string, stellarAddress: string }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBrlAmount } from '@/lib/format/parse-brl';
import { logStellarError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const { amountBrl, customerId, stellarAddress } = (await req.json()) as {
      amountBrl?: string;
      customerId?: string;
      stellarAddress?: string;
    };
    if (!amountBrl || !customerId || !stellarAddress) {
      return NextResponse.json(
        { error: 'amountBrl, customerId, stellarAddress obrigatórios' },
        { status: 400 },
      );
    }
    const amountValue = parseBrlAmount(amountBrl);
    if (amountValue === null) {
      return NextResponse.json(
        { error: 'amountBrl inválido' },
        { status: 400 },
      );
    }
    const amountBrlNormalized = amountValue.toFixed(2);

    // Defense in depth: body precisa casar com o investidor autenticado.
    // Sem isso, o token só prova identidade — qualquer um logado poderia
    // cotar pra wallet alheia.
    if (customerId !== user.etherfuseCustomerId) {
      return NextResponse.json(
        { error: 'customerId não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }
    if (stellarAddress !== user.publicKey) {
      return NextResponse.json(
        { error: 'stellarAddress não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }

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

    const quote = await anchor.getQuote({
      fromCurrency: 'BRL',
      toCurrency: 'TESOURO',
      fromAmount: amountBrlNormalized,
      customerId,
      stellarAddress,
    });

    // N-12: arredondamento explícito em 7 casas. Etherfuse devolve
    // toAmount com até 18 dígitos; Decimal(20,7) do Prisma truncava
    // silencioso no save, gerando dust no swap. Round HALF_EVEN
    // (banqueiro) + log quando houve perda de precisão pra rastrear.
    const toAmountRaw = new Prisma.Decimal(quote.toAmount);
    const toAmount = toAmountRaw.toDecimalPlaces(
      7,
      Prisma.Decimal.ROUND_HALF_EVEN,
    );
    if (!toAmountRaw.eq(toAmount)) {
      logStellarError(
        '[quote] toAmount truncado pra 7 casas',
        new Error(
          `raw=${toAmountRaw.toFixed()} rounded=${toAmount.toFixed(7)}`,
        ),
      );
    }
    const fromAmountRaw = new Prisma.Decimal(quote.fromAmount);
    const fromAmount = fromAmountRaw.toDecimalPlaces(
      7,
      Prisma.Decimal.ROUND_HALF_EVEN,
    );
    if (!fromAmountRaw.eq(fromAmount)) {
      logStellarError(
        '[quote] fromAmount truncado pra 7 casas',
        new Error(
          `raw=${fromAmountRaw.toFixed()} rounded=${fromAmount.toFixed(7)}`,
        ),
      );
    }

    await db.quote.create({
      data: {
        id: quote.id,
        investidorId: user.investidorId,
        fromCurrency: quote.fromCurrency,
        fromAmount,
        toCurrency: quote.toCurrency,
        toAmount,
        exchangeRate: quote.exchangeRate,
        fee: quote.fee,
        expiresAt: new Date(quote.expiresAt),
      },
    });

    return NextResponse.json({
      quoteId: quote.id,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      exchangeRate: quote.exchangeRate,
      fee: quote.fee,
      expiresAt: quote.expiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
