/**
 * Resposta 500 fixa para rotas com `NextResponse.json` cru (L1-S5): o corpo
 * nunca leva `err.message` (pode citar config, banco ou SDK); a causa vai só
 * ao log do servidor, sem corpo de request.
 */

import { NextResponse } from 'next/server';
import { extractSafeError } from '@/lib/stellar/log-error';

export function internalErrorResponse(err: unknown, tag: string): NextResponse {
  console.error(`[${tag}] erro interno`, extractSafeError(err));
  return NextResponse.json({ error: 'erro interno' }, { status: 500 });
}
