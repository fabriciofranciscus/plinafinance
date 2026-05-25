/**
 * POST /api/investidor/liquidar/build
 *
 * Monta XDR de payment PLINARF investor → distributor. Investidor assina
 * via Privy useSignRawHash.
 *
 * Body: { pubkey, amount }
 */

import { NextResponse } from 'next/server';
import { StrKey } from '@stellar/stellar-sdk';
import { buildLiquidarPlinarfXdr } from '@/lib/services/liquidacao';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = (await req.json()) as { pubkey?: string; amount?: string };
    if (!body.pubkey || !StrKey.isValidEd25519PublicKey(body.pubkey)) {
      return NextResponse.json({ error: 'pubkey inválida' }, { status: 400 });
    }
    if (body.pubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'pubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }
    if (!body.amount) {
      return NextResponse.json({ error: 'amount obrigatório' }, { status: 400 });
    }
    const result = await buildLiquidarPlinarfXdr({
      investorPubkey: body.pubkey,
      amount: body.amount,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
