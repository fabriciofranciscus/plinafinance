/**
 * POST /api/vender/aceitar-oferta
 *
 * Vendedor aceita a oferta firme. Audit on-chain + transição de estados
 * Oferta → ACEITA, LeadVendedor → OFERTA_ACEITA.
 *
 * Body: { ofertaId }
 */

import { NextResponse } from 'next/server';
import { aceitarOferta } from '@/lib/services/originacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { ofertaId?: string };
    if (!body.ofertaId) {
      return NextResponse.json({ error: 'ofertaId obrigatório' }, { status: 400 });
    }
    const result = await aceitarOferta(body.ofertaId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
