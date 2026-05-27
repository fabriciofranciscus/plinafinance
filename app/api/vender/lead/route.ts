/**
 * POST /api/vender/lead
 *
 * Captura lead vendedor + prova on-chain do consentimento LGPD.
 *
 * C-06: Zod strict + rate-limit anti-spam.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { capturarLead } from '@/lib/services/originacao';
import { parseBody } from '@/lib/http/parse-body';
import { leadLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    nome: z.string().min(1).max(200),
    email: z.string().email().max(254),
    telefone: z.string().max(40).optional(),
    cpf: z.string().max(40).optional(),
    consentimentoLgpd: z.literal(true),
    origem: z.string().max(100).optional(),
    utmSource: z.string().max(100).optional(),
    utmMedium: z.string().max(100).optional(),
    utmCampaign: z.string().max(100).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (!(await leadLimiter.consume(clientIp(req)))) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    const result = await capturarLead({
      nome: body.nome,
      email: body.email,
      telefone: body.telefone,
      cpf: body.cpf,
      consentimentoLgpd: true,
      origem: body.origem,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
