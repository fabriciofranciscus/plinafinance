/**
 * POST /api/investidor/quote
 *
 * Quote via Etherfuse (real). Suporta as duas direções:
 *
 *   - **On-ramp (default)**: body `{ amountBrl, customerId, stellarAddress }`.
 *     BRL → TESOURO. Plina white-label exibe quote antes de "comprar PLINA-RF".
 *   - **Off-ramp** (PLINA-MOD-007 follow-up): body `{ amountTesouro,
 *     direction: 'offramp', customerId, stellarAddress }`. TESOURO → BRL.
 *     Usado em `/sacar` pra montar order de saque PIX.
 *
 * Persiste no DB (`Quote`) pra binding server-side: /buy/swap/{build,submit}
 * (onramp) ou /buy/offramp/create (offramp). Sem isso a emissão/burn aceitaria
 * `amount` arbitrário do body.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { stellarPubkey } from '@/lib/http/zod-stellar';
import { parseBrlAmount } from '@/lib/format/parse-brl';
import { logStellarError } from '@/lib/stellar/log-error';
import { mainnetCutoverGuard } from '@/lib/env/feature-gates';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    amountBrl: z.string().max(40).optional(),
    amountTesouro: z.string().max(40).optional(),
    direction: z.enum(['onramp', 'offramp']).optional(),
    customerId: z.string().min(1).max(100),
    stellarAddress: stellarPubkey(),
  })
  .strict()
  .refine(
    (b) =>
      (b.direction ?? 'onramp') === 'offramp'
        ? typeof b.amountTesouro === 'string' && b.amountTesouro.length > 0
        : typeof b.amountBrl === 'string' && b.amountBrl.length > 0,
    {
      message:
        'amountBrl obrigatório em direction=onramp; amountTesouro obrigatório em direction=offramp',
    },
  );

export const POST = withAuth(async (req, { user }) => {
  const cutover = await mainnetCutoverGuard();
  if (cutover) return cutover;
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    const { customerId, stellarAddress } = body;
    const direction = body.direction ?? 'onramp';

    let sourceAmount: string;
    let fromCurrency: string;
    let toCurrency: string;
    if (direction === 'offramp') {
      const v = Number(body.amountTesouro);
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json(
          { error: 'amountTesouro inválido' },
          { status: 400 },
        );
      }
      sourceAmount = v.toFixed(7);
      fromCurrency = 'TESOURO';
      toCurrency = 'BRL';
    } else {
      const amountValue = parseBrlAmount(body.amountBrl!);
      if (amountValue === null) {
        return NextResponse.json(
          { error: 'amountBrl inválido' },
          { status: 400 },
        );
      }
      sourceAmount = amountValue.toFixed(2);
      fromCurrency = 'BRL';
      toCurrency = 'TESOURO';
    }

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
      fromCurrency,
      toCurrency,
      fromAmount: sourceAmount,
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
        // Persiste códigos normalizados (BRL, TESOURO), não os resolvidos
        // pela Etherfuse com `:ISSUER` — handlers downstream (/buy/swap,
        // /buy/offramp/create) comparam contra códigos crus.
        fromCurrency,
        fromAmount,
        toCurrency,
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
