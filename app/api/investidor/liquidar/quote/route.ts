/**
 * POST /api/investidor/liquidar/quote
 *
 * Calcula BRL equivalente a uma quantidade de PLINA-RF, a NAV atual do
 * pool. Não submete nada.
 *
 * N-08: handler faz 2 findMany (Cota + RealizacaoCaminho) por request.
 * Vetor barato de DoS DB com 1 sessão Privy válida → sensitiveAuthLimiter
 * (10 req/min por IP, mesmo bucket de onboard).
 *
 * Body: { amountPlinarf }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { calcularValorLiquidacao } from '@/lib/services/liquidacao';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    amountPlinarf: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'amountPlinarf deve ser numérico')
      .refine((v) => Number(v) > 0, 'amountPlinarf deve ser > 0'),
  })
  .strict();

export const POST = withAuth(async (req, _ctx) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  try {
    const result = await calcularValorLiquidacao({
      amountPlinarf: parsed.data.amountPlinarf,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
