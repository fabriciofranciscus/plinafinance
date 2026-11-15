/**
 * GET /api/me/resumo — resumo da conta da PRÓPRIA Pessoa (item 12; contratos/2026-11-15-me-resumo-historico.md).
 * withPessoaAuth; só leitura; sem PII; resposta direta (sem envelope).
 */

import { NextResponse } from 'next/server';
import { publicLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { montarResumo } from '@/lib/services/me';

export const dynamic = 'force-dynamic';

export const GET = withPessoaAuth(async (req, { user }) => {
  if (!(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  try {
    return NextResponse.json(await montarResumo(user));
  } catch (err) {
    console.error('[me/resumo]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
});
