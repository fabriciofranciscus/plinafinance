/**
 * N-10 + N-11: CSRF defense em rotas admin POST.
 *
 * Cookie `plina_admin` é SameSite=lax — bloqueia POST cross-site XHR mas
 * permite top-level form submit (e.g. <form action="/api/admin/logout"
 * method=POST> hospedado em outro origin força logout). Defesa:
 *
 *  - Exige header `x-plina-admin: 1`. Forms HTML não conseguem setar
 *    headers customizados; só fetch/XHR, que dispara preflight CORS em
 *    cross-origin → bloqueado.
 *  - Defesa em profundidade: valida `origin` (ou `referer` fallback)
 *    contra o host do próprio request. Origem externa → 403.
 *
 * Retorna `NextResponse` 403 pronta pro caller ou `null` quando passa.
 * Helper, não middleware — fica explícito em cada rota.
 */
import { NextResponse } from 'next/server';

const CSRF_HEADER = 'x-plina-admin';

export function requireAdminCsrf(req: Request): NextResponse | null {
  if (req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json(
      { error: 'csrf header ausente' },
      { status: 403 },
    );
  }
  // Origin é preferido (sempre presente em CORS-relevant requests
  // modernos); referer é fallback pra requests same-origin sem origin.
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (origin) {
    try {
      const reqHost = new URL(req.url).host;
      const originHost = new URL(origin).host;
      if (originHost !== reqHost) {
        return NextResponse.json(
          { error: 'origin divergente' },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'origin inválido' },
        { status: 403 },
      );
    }
  }
  return null;
}
