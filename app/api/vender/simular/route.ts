/**
 * POST /api/vender/simular
 *
 * Faixa indicativa (não oferta firme). Não persiste nada — só retorna
 * cálculo. Usado pelo simulador no /vender.
 *
 * Body: { tipoBem, administradora, valorCarta, prazoRestanteMeses? }
 */

import { NextResponse } from 'next/server';
import { calcularFaixaIndicativa } from '@/lib/services/originacao';
import { TipoBem } from '@prisma/client';
import { clientIp, createRateLimiter } from '@/lib/rate-limit/in-memory';

export const dynamic = 'force-dynamic';

const TIPOS_VALIDOS: TipoBem[] = ['IMOVEL', 'VEICULO', 'EQUIPAMENTO', 'SERVICO'];

// 20 reqs/min por IP — barreira contra reconnaissance do oracle de preço.
const rateLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: Request) {
  try {
    const bypass = process.env.PLINA_RATE_LIMIT_BYPASS;
    const allowBypass =
      !!bypass && req.headers.get('x-plina-bypass') === bypass;
    if (!allowBypass && !rateLimiter.consume(clientIp(req))) {
      return NextResponse.json(
        { error: 'Too Many Requests' },
        { status: 429, headers: { 'retry-after': '60' } },
      );
    }
    const body = (await req.json()) as {
      tipoBem?: string;
      administradora?: string;
      valorCarta?: string;
      prazoRestanteMeses?: number;
    };
    if (!body.tipoBem || !TIPOS_VALIDOS.includes(body.tipoBem as TipoBem)) {
      return NextResponse.json({ error: 'tipoBem inválido' }, { status: 400 });
    }
    if (!body.valorCarta || isNaN(Number(body.valorCarta))) {
      return NextResponse.json({ error: 'valorCarta inválido' }, { status: 400 });
    }
    if (Number(body.valorCarta) <= 0) {
      return NextResponse.json({ error: 'valorCarta deve ser > 0' }, { status: 400 });
    }

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
