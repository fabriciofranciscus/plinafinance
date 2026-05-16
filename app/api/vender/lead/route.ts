/**
 * POST /api/vender/lead
 *
 * Captura lead vendedor + prova on-chain do consentimento LGPD.
 *
 * Body: { nome, email, telefone?, cpf?, consentimentoLgpd, utm_* }
 * Returns: { leadId, payloadHash, txHash }
 */

import { NextResponse } from 'next/server';
import { capturarLead } from '@/lib/services/originacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      nome?: string;
      email?: string;
      telefone?: string;
      cpf?: string;
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
