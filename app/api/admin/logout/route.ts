/**
 * POST /api/admin/logout — clears plina_admin cookie + redirects /admin.
 *
 * Form POST a partir do AppHeader (sem JS necessário pra logout).
 */

import { NextResponse } from 'next/server';
import { clearAdminCookie } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await clearAdminCookie();
  const url = new URL('/admin', req.url);
  return NextResponse.redirect(url, { status: 303 });
}
