/**
 * POST /api/investidor/liquidar/build
 *
 * Monta XDR de payment PLINARF investor → distributor. Investidor assina
 * via Privy useSignRawHash.
 *
 * Body: { pubkey, amount }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLiquidarPlinarfXdr } from '@/lib/services/liquidacao';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { stellarPubkey } from '@/lib/http/zod-stellar';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    pubkey: stellarPubkey(),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'amount deve ser numérico')
      .refine((v) => Number(v) > 0, 'amount deve ser > 0'),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { pubkey, amount } = parsed.data;
  try {
    if (pubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'pubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }
    const result = await buildLiquidarPlinarfXdr({
      investorPubkey: pubkey,
      amount,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
