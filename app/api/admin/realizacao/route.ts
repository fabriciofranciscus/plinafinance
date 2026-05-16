/**
 * POST /api/admin/realizacao
 *
 * Multiplexor admin pra ações de realização de cota.
 *
 * Actions:
 *   - cancelar-reserva       → libera cota de volta a DISPONIVEL
 *   - executar-caminho-a     → finaliza Caminho A: cota → REALIZADA + spread
 */

import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import {
  cancelarReserva,
  executarCaminhoA,
} from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { action?: string } & Record<string, unknown>;
    switch (body.action) {
      case 'cancelar-reserva': {
        await cancelarReserva(String(body.reservaId), 'admin-panel');
        return NextResponse.json({ ok: true });
      }
      case 'executar-caminho-a': {
        const result = await executarCaminhoA({
          reservaId: String(body.reservaId),
          valorRealizado: String(body.valorRealizado),
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          { error: `action desconhecida: ${body.action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
