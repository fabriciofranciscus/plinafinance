/**
 * POST /api/vender/aceitar-oferta
 *
 * Vendedor aceita a oferta firme. Audit on-chain + transição de estados
 * Oferta → ACEITA, LeadVendedor → OFERTA_ACEITA.
 *
 * Body: { ofertaId }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aceitarOferta } from '@/lib/services/originacao';
import { parseBody } from '@/lib/http/parse-body';

export const dynamic = 'force-dynamic';

const Schema = z.object({ ofertaId: z.string().min(1).max(60) }).strict();

export async function POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { ofertaId } = parsed.data;
  try {
    const result = await aceitarOferta(ofertaId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
