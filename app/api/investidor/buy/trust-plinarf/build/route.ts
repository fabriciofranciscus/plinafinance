/**
 * POST /api/investidor/buy/trust-plinarf/build
 *
 * Monta tx de trustline pro investor → PLINARF. Investor assina via Privy.
 * Idempotente: chama fundAccountIfNeeded(); o issuer autoriza no /submit.
 *
 * Substitui o legacy /buy/build (que carregava também o passo de distribute
 * single-shot, agora separado em /buy/swap após onramp settlement).
 *
 * Body: { pubkey: string }
 * Returns: { xdr, hashHex, funded }
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const { pubkey } = (await req.json()) as { pubkey?: string };
    if (!pubkey || !pubkey.startsWith('G')) {
      return NextResponse.json({ error: 'pubkey inválida' }, { status: 400 });
    }
    if (pubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'pubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
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
});
