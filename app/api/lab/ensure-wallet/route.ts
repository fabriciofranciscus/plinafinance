/**
 * POST /api/lab/ensure-wallet
 *
 * Idempotente — server consulta Privy, retorna endereço Stellar do user,
 * criando server-side se necessário. Evita o bug "uma wallet por login".
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Returns: { address }
 */

import { NextResponse } from 'next/server';
import {
  ensureStellarWallet,
  getPrivyClient,
} from '@/lib/wallet/privy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json(
        { error: 'token Privy ausente (header Authorization)' },
        { status: 401 },
      );
    }

    const privy = getPrivyClient();
    const claims = await privy.verifyAuthToken(token);
    const address = await ensureStellarWallet(claims.userId);
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
