/**
 * POST /api/investidor/onboard
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { nome?: string }
 *
 * Cria/recupera Investidor: Privy wallet + Etherfuse customer + KYC
 * programático + DB record. Idempotente.
 */

import { NextResponse } from 'next/server';
import { onboardInvestidor } from '@/lib/services/investidor';
import { getPrivyClient } from '@/lib/wallet/privy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json(
        { error: 'token Privy ausente' },
        { status: 401 },
      );
    }
    const privy = getPrivyClient();
    const claims = await privy.verifyAuthToken(token);

    const body = (await req.json().catch(() => ({}))) as {
      nome?: string;
      cpf?: string;
    };

    // Email vem do Privy user (linkedAccounts).
    const user = await privy.getUserById(claims.userId);
    const linked = (user.linkedAccounts ?? []) as Array<{
      type: string;
      email?: string;
      address?: string;
    }>;
    const email =
      linked.find((a) => a.type === 'email')?.email ??
      `${claims.userId.replace(/[^a-z0-9]/g, '')}@privy.plina.local`;

    const result = await onboardInvestidor({
      privyId: claims.userId,
      email,
      nome: body.nome,
      cpf: body.cpf,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError = message.startsWith('cpf obrigatório');
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
}
