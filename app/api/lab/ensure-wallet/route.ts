/**
 * POST /api/lab/ensure-wallet
 *
 * Idempotente — devolve o endereço Stellar do user (provisionado via
 * Privy MPC custody se necessário). Evita "uma wallet por login".
 *
 * C-07: gateado por LAB_ENABLED (testnet-only opt-in) + withAuth.
 * Header: Authorization: Bearer <privy-access-token>
 * Returns: { address }
 */

import { NextResponse } from 'next/server';
import { ensureStellarWallet } from '@/lib/wallet/privy';
import { withAuth } from '@/lib/wallet/auth-guard';
import { isLabEnabled } from '@/lib/env/lab';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_req, { user }) => {
  if (!isLabEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const address = await ensureStellarWallet(user.privyId);
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
