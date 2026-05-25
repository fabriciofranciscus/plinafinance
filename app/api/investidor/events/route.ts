/**
 * GET /api/investidor/events
 *
 * Eventos do investidor (audit log filtrado pelo investidor logado).
 * Headers: Authorization: Bearer <privy-access-token>
 *
 * 401 sem token / token inválido. 403 se token Privy não tem Investidor
 * onboardado (auth-guard). Lookup direto por user.investidorId — não
 * passa mais por email + privy.getUserById.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/wallet/auth-guard';
import { stripInternalKeys } from '@/lib/audit/strip-internal';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, { user }) => {
  const investidor = await db.investidor.findUnique({
    where: { id: user.investidorId },
    include: {
      eventos: {
        orderBy: { criadoEm: 'desc' },
        take: 50,
      },
    },
  });
  if (!investidor) {
    // Defensiva — guard já validou; só cai aqui se tabela mudou no meio.
    return NextResponse.json({ events: [], investidorId: null });
  }

  return NextResponse.json({
    investidorId: investidor.id,
    events: investidor.eventos.map((e) => ({
      id: e.id,
      acao: e.acao,
      criadoEm: e.criadoEm,
      stellarTxHash: e.stellarTxHash,
      motivoClawback: e.motivoClawback,
      fundamentoUrl: e.fundamentoUrl,
      // N-17: strip de chaves canônicas internas (_type/_at/_ref) injetadas
      // por buildAuditPayload. Consumidor não precisa ver o envelope de hash.
      payload: stripInternalKeys(e.payloadJson),
    })),
  });
});
