/**
 * POST /api/comprar/reservar
 *
 * Cria reserva de cota por 72h. Body: { cotaId, leadCompradorId, sinalSimulado? }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { criarReserva } from '@/lib/services/realizacao';
import { parseBody } from '@/lib/http/parse-body';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    cotaId: z.string().min(1).max(60),
    leadCompradorId: z.string().min(1).max(60),
    sinalSimulado: z.string().max(40).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    const result = await criarReserva({
      cotaId: body.cotaId,
      leadCompradorId: body.leadCompradorId,
      sinalSimulado: body.sinalSimulado,
    });
    return NextResponse.json({
      reservaId: result.reservaId,
      expiraEm: result.expiraEm.toISOString(),
      payloadHash: result.payloadHash,
      txHash: result.txHash,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
