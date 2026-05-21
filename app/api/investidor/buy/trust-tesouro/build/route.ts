/**
 * POST /api/investidor/buy/trust-tesouro/build
 *
 * Monta tx de trustline pro investor → TESOURO (asset bridge da Etherfuse).
 * Pré-requisito pro caminho real: pra Etherfuse pagar TESOURO na wallet do
 * investor (após PIX), a wallet precisa ter trustline TESOURO. Idempotente:
 * Stellar não falha se trustline já existe (limit fica em max default).
 *
 * Body: { pubkey: string }
 * Returns: { xdr, hashHex, tesouroCode, tesouroIssuer }
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
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
    await fundAccountIfNeeded(pubkey);
    const tesouro = await resolveTesouroAsset(pubkey);
    const { xdr, hashHex } = await buildTrustlineXdr(
      pubkey,
      tesouro.issuer,
      tesouro.code,
    );
    return NextResponse.json({
      xdr,
      hashHex,
      tesouroCode: tesouro.code,
      tesouroIssuer: tesouro.issuer,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
