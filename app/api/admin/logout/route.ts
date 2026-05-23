/**
 * POST /api/admin/logout — clears plina_admin cookie + redirects /admin.
 *
 * N-11: aceitava POST cross-site via SameSite=lax. Cross-site
 * <form action> forçava logout (DoS de produtividade). Agora exige
 * header `x-plina-admin: 1` validado server-side — forms HTML não
 * conseguem setar headers, só fetch/XHR com preflight.
 */

import { NextResponse } from 'next/server';
import { clearAdminCookie } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  await clearAdminCookie();
  const url = new URL('/admin', req.url);
  return NextResponse.redirect(url, { status: 303 });
}
