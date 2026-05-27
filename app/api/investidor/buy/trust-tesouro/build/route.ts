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
import { z } from 'zod';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { stellarPubkey } from '@/lib/http/zod-stellar';

export const dynamic = 'force-dynamic';

const Schema = z.object({ pubkey: stellarPubkey() }).strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { pubkey } = parsed.data;
  try {
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
