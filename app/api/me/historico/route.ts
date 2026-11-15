/**
 * GET /api/me/historico?cursor=&limit= — histórico da PRÓPRIA Pessoa, mais recente primeiro (item 12;
 * contratos/2026-11-15-me-resumo-historico.md). withPessoaAuth; só leitura; sem PII; paginação por cursor opaco.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { publicLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { CursorInvalidoError, montarHistorico } from '@/lib/services/me';

export const dynamic = 'force-dynamic';

const Query = z
  .object({
    cursor: z.string().min(1).max(300).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export const GET = withPessoaAuth(async (req, { user }) => {
  if (!(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'parâmetros inválidos' }, { status: 400 });
  try {
    return NextResponse.json(await montarHistorico(user, parsed.data));
  } catch (err) {
    if (err instanceof CursorInvalidoError) return NextResponse.json({ error: 'cursor inválido' }, { status: 400 });
    console.error('[me/historico]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
});
