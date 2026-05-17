/**
 * POST /api/investidor/buy/build
 *
 * Monta tx de trustline pro investor → PLINARF. Investor assina via Privy.
 * Distribuição real (issuer authorize + distributor payment) acontece no
 * buy/submit após o investor assinar a trustline.
 *
 * Body: { pubkey: string }
 * Returns: { xdr, hashHex, funded, issuerPubkey, assetCode }
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { pubkey } = (await req.json()) as { pubkey?: string };
    if (!pubkey || !pubkey.startsWith('G')) {
      return NextResponse.json({ error: 'pubkey inválida' }, { status: 400 });
    }
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    if (!issuerPubkey) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_PUBLIC ausente' },
        { status: 500 },
      );
    }
    const fund = await fundAccountIfNeeded(pubkey);
    const assetCode = process.env.ASSET_CODE ?? 'PLINARF';
    const { xdr, hashHex } = await buildTrustlineXdr(pubkey, issuerPubkey, assetCode);
    return NextResponse.json({
      xdr,
      hashHex,
      funded: fund.funded,
      issuerPubkey,
      assetCode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
