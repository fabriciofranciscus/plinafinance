/**
 * POST /api/comprar/lead
 *
 * Captura lead comprador-usuário + prova on-chain LGPD.
 *
 * C-06: body validado por Zod strict (rejeita shapes inesperados) +
 * rate-limit anti-spam (leadLimiter — 5 req/min por IP).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { capturarLeadComprador } from '@/lib/services/realizacao';
import { LeadCompradorTipo } from '@prisma/client';
import { parseBody } from '@/lib/http/parse-body';
import { leadLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    nome: z.string().min(1).max(200),
    email: z.string().email().max(254),
    telefone: z.string().max(40).optional(),
    documento: z.string().max(40).optional(),
    tipo: z.enum(['PESSOA_FISICA', 'PESSOA_JURIDICA']).optional(),
    intencaoBem: z.string().max(500).optional(),
    faixaCapital: z.string().max(100).optional(),
    prazoDecisao: z.string().max(100).optional(),
    consentimentoLgpd: z.literal(true),
    origem: z.string().max(100).optional(),
    utmSource: z.string().max(100).optional(),
    utmMedium: z.string().max(100).optional(),
    utmCampaign: z.string().max(100).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (!leadLimiter.consume(clientIp(req))) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    const tipo: LeadCompradorTipo =
      body.tipo === 'PESSOA_JURIDICA'
        ? LeadCompradorTipo.PESSOA_JURIDICA
        : LeadCompradorTipo.PESSOA_FISICA;
    const result = await capturarLeadComprador({
      nome: body.nome,
      email: body.email,
      telefone: body.telefone,
      documento: body.documento,
      tipo,
      intencaoBem: body.intencaoBem,
      faixaCapital: body.faixaCapital,
      prazoDecisao: body.prazoDecisao,
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
