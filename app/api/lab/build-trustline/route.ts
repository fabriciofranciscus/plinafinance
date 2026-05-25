/**
 * POST /api/lab/build-trustline
 *
 * Smoke endpoint pro /lab. Recebe `{}` (pubkey vem do JWT), monta XDR de
 * changeTrust pra PLINARF, devolve `{xdr, hashHex}` pro frontend assinar
 * via Privy rawSign.
 *
 * C-07: gateado por LAB_ENABLED (testnet-only opt-in) + withAuth.
 * Em mainnet retorna 404 (não vaza existência). Em testnet exige
 * Bearer JWT do Privy; pubkey sai do token, nunca do body.
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';
import { withAuth } from '@/lib/wallet/auth-guard';
import { isLabEnabled } from '@/lib/env/lab';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_req, { user }) => {
  if (!isLabEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const pubkey = user.publicKey;
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    if (!issuerPubkey) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_PUBLIC não configurado' },
        { status: 500 },
      );
    }

    // Privy wallets nascem sem XLM (só no MPC custody). Funda via friendbot
    // se a conta não existe on-chain ainda. No-op silencioso pra contas
    // existentes.
    const fundResult = await fundAccountIfNeeded(pubkey);

    const { xdr, hashHex } = await buildTrustlineXdr(pubkey, issuerPubkey);
    return NextResponse.json({ xdr, hashHex, funded: fundResult.funded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
