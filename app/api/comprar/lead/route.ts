/**
 * POST /api/comprar/lead
 *
 * Captura lead comprador-usuário + prova on-chain LGPD.
 * Body: { nome, email, telefone?, documento?, tipo, intencaoBem?, ... }
 */

import { NextResponse } from 'next/server';
import { capturarLeadComprador } from '@/lib/services/realizacao';
import { LeadCompradorTipo } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      nome?: string;
      email?: string;
      telefone?: string;
      documento?: string;
      tipo?: string;
      intencaoBem?: string;
      faixaCapital?: string;
      prazoDecisao?: string;
      consentimentoLgpd?: boolean;
      origem?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
    };

    if (!body.nome || !body.email) {
      return NextResponse.json(
        { error: 'nome e email obrigatórios' },
        { status: 400 },
      );
    }
    if (!body.consentimentoLgpd) {
      return NextResponse.json(
        { error: 'Consentimento LGPD obrigatório' },
        { status: 400 },
      );
    }
    const tipoRaw = String(body.tipo ?? '').trim().toUpperCase();
    if (
      tipoRaw &&
      tipoRaw !== 'PESSOA_FISICA' &&
      tipoRaw !== 'PESSOA_JURIDICA'
    ) {
      return NextResponse.json(
        { error: 'tipo deve ser PESSOA_FISICA ou PESSOA_JURIDICA' },
        { status: 400 },
      );
    }
    const tipo: LeadCompradorTipo =
      tipoRaw === 'PESSOA_JURIDICA'
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
