/**
 * POST /api/vender/simular
 *
 * Faixa indicativa (não oferta firme). Não persiste nada — só retorna
 * cálculo. Usado pelo simulador no /vender.
 *
 * Body: { tipoBem, administradora, valorCarta, prazoRestanteMeses? }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { calcularFaixaIndicativa } from '@/lib/services/originacao';
import { TipoBem } from '@prisma/client';
import { parseBody } from '@/lib/http/parse-body';
import { clientIp, publicLimiter } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    tipoBem: z.enum(['IMOVEL', 'VEICULO', 'EQUIPAMENTO', 'SERVICO']),
    administradora: z.string().max(200).optional(),
    valorCarta: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'valorCarta deve ser numérico')
      .refine((v) => Number(v) > 0, 'valorCarta deve ser > 0'),
    prazoRestanteMeses: z.number().int().positive().max(600).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const bypass = process.env.PLINA_RATE_LIMIT_BYPASS;
  const allowBypass =
    !!bypass && req.headers.get('x-plina-bypass') === bypass;
  if (!allowBypass && !(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json(
      { error: 'Too Many Requests' },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    const faixa = calcularFaixaIndicativa({
      tipoBem: body.tipoBem as TipoBem,
      administradora: body.administradora ?? '',
      valorCarta: body.valorCarta,
      prazoRestanteMeses: body.prazoRestanteMeses,
    });
    return NextResponse.json(faixa);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
