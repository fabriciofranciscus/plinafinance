/**
 * Resposta 503 fixa para "NAV indisponível" nas rotas de resgate que ainda usam
 * `NextResponse.json` cru. Corpo constante — nunca `err.message`; a causa vai
 * só para o log (M1-4). Retorna `null` se o erro não é de NAV indisponível.
 */

import { NextResponse } from 'next/server';
import {
  NAV_INDISPONIVEL_MENSAGEM,
  NavIndisponivelError,
} from '@/lib/services/nav-supply';

export function navUnavailableResponse(err: unknown, tag: string): NextResponse | null {
  if (!(err instanceof NavIndisponivelError)) return null;
  console.error(`[${tag}] NAV indisponível`, { motivo: err.motivo });
  return NextResponse.json(
    { error: NAV_INDISPONIVEL_MENSAGEM, code: err.code },
    { status: 503 },
  );
}
