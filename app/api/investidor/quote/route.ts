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

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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

    // Investidor precisa existir antes do quote (FK do Quote). Lookup
    // por etherfuseCustomerId — assim o cliente não consegue spoofar
    // investidorId no body.
    const investidor = await db.investidor.findFirst({
      where: { etherfuseCustomerId: customerId },
      select: { id: true },
    });
    if (!investidor) {
      return NextResponse.json(
        { error: 'investidor não encontrado pra esse customerId' },
        { status: 404 },
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
      fromAmount: amountBrl,
      customerId,
      stellarAddress,
    });

    // Persiste com Decimal(20,7) — Stellar amount aceita até 7 decimais.
    // Etherfuse devolve `toAmount` em string com precisão maior; Decimal
    // do Prisma trunca/arredonda conservadoramente.
    await db.quote.create({
      data: {
        id: quote.id,
        investidorId: investidor.id,
        fromCurrency: quote.fromCurrency,
        fromAmount: new Prisma.Decimal(quote.fromAmount),
        toCurrency: quote.toCurrency,
        toAmount: new Prisma.Decimal(quote.toAmount),
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
}
