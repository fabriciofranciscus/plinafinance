/**
 * POST /api/investidor/quote
 *
 * Quote BRL → TESOURO via Etherfuse (real). Plina white-label exibe pro
 * investidor o quote da anchor antes de "comprar PLINA-RF".
 *
 * Body: { amountBrl: string, customerId: string, stellarAddress: string }
 */

import { NextResponse } from 'next/server';
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
