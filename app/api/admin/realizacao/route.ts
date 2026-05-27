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
import { z } from 'zod';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';
import { parseBody } from '@/lib/http/parse-body';
import {
  cancelarReserva,
  executarCaminhoA,
} from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

const Schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('cancelar-reserva'),
      reservaId: z.string().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal('executar-caminho-a'),
      reservaId: z.string().min(1).max(60),
      valorRealizado: z
        .string()
        .regex(/^\d+(\.\d+)?$/, 'valorRealizado deve ser numérico'),
    })
    .strict(),
]);

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    switch (body.action) {
      case 'cancelar-reserva': {
        const result = await cancelarReserva(body.reservaId, 'admin-panel');
        return NextResponse.json({ ok: true, ...result });
      }
      case 'executar-caminho-a': {
        const result = await executarCaminhoA({
          reservaId: body.reservaId,
          valorRealizado: body.valorRealizado,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
