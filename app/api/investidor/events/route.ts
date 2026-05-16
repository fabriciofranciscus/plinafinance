/**
 * GET /api/investidor/events
 *
 * Eventos do investidor (audit log filtrado pelo investidor logado).
 * Headers: Authorization: Bearer <privy-access-token>
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPrivyClient } from '@/lib/wallet/privy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json({ events: [] });
    }

    const privy = getPrivyClient();
    const claims = await privy.verifyAuthToken(token);
    const user = await privy.getUserById(claims.userId);
    const linked = (user.linkedAccounts ?? []) as Array<{
      type: string;
      email?: string;
      address?: string;
    }>;
    const email = linked.find((a) => a.type === 'email')?.email;
    if (!email) {
      return NextResponse.json({ events: [] });
    }

    const investidor = await db.investidor.findUnique({
      where: { email },
      include: {
        eventos: {
          orderBy: { criadoEm: 'desc' },
          take: 50,
        },
      },
    });
    if (!investidor) return NextResponse.json({ events: [], investidorId: null });

    return NextResponse.json({
      investidorId: investidor.id,
      events: investidor.eventos.map((e) => ({
        id: e.id,
        acao: e.acao,
        criadoEm: e.criadoEm,
        stellarTxHash: e.stellarTxHash,
        motivoClawback: e.motivoClawback,
        fundamentoUrl: e.fundamentoUrl,
        payload: e.payloadJson,
      })),
    });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
