/**
 * POST /api/investidor/liquidar/build
 *
 * Monta XDR de payment PLINARF investor → distributor. Investidor assina
 * via Privy useSignRawHash.
 *
 * Body: { pubkey, amount }
 */

import { NextResponse } from 'next/server';
import { buildLiquidarPlinarfXdr } from '@/lib/services/liquidacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { pubkey?: string; amount?: string };
    if (!body.pubkey || !body.pubkey.startsWith('G')) {
      return NextResponse.json({ error: 'pubkey inválida' }, { status: 400 });
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
}
