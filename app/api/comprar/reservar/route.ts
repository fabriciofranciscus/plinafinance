/**
 * POST /api/comprar/reservar
 *
 * Cria reserva de cota por 72h. Body: { cotaId, leadCompradorId, sinalSimulado? }
 */

import { NextResponse } from 'next/server';
import { criarReserva } from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      cotaId?: string;
      leadCompradorId?: string;
      sinalSimulado?: string;
    };
    if (!body.cotaId || !body.leadCompradorId) {
      return NextResponse.json(
        { error: 'cotaId e leadCompradorId obrigatórios' },
        { status: 400 },
      );
    }
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
