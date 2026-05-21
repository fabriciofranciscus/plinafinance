/**
 * POST /api/investidor/liquidar/quote
 *
 * Calcula BRL equivalente a uma quantidade de PLINA-RF, a NAV atual do
 * pool. Não submete nada.
 *
 * Body: { amountPlinarf }
 */

import { NextResponse } from 'next/server';
import { calcularValorLiquidacao } from '@/lib/services/liquidacao';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, _ctx) => {
  try {
    const body = (await req.json()) as { amountPlinarf?: string };
    if (!body.amountPlinarf) {
      return NextResponse.json(
        { error: 'amountPlinarf obrigatório' },
        { status: 400 },
      );
    }
    const result = await calcularValorLiquidacao({
      amountPlinarf: body.amountPlinarf,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
