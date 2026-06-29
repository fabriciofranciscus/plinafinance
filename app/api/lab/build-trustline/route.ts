/**
 * POST /api/lab/build-trustline
 *
 * Smoke endpoint pro /lab. Recebe `{}` (pubkey vem do JWT), monta XDR de
 * changeTrust pra PLINARF, devolve `{xdr, hashHex}` pro frontend assinar
 * via Privy rawSign.
 *
 * C-07: gateado por LAB_ENABLED (testnet-only opt-in) + auth.
 * Em mainnet retorna 404 (não vaza existência). Em testnet exige
 * Bearer JWT do Privy; pubkey sai do token, nunca do body.
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';
import { fundAccountIfNeeded } from '@/lib/stellar/account';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { isLabEnabled } from '@/lib/env/lab';

export const dynamic = 'force-dynamic';

export const POST = withApi(async (req, { requestId }) => {
  // 404 cru (não vaza existência), antes de qualquer auth.
  if (!isLabEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const user = await requireInvestidor(req);
  const pubkey = user.publicKey;
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  if (!issuerPubkey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('STELLAR_ISSUER_PUBLIC não configurado');
  }

  // Privy wallets nascem sem XLM (só no MPC custody). Funda via friendbot
  // se a conta não existe on-chain ainda. No-op silencioso pra contas
  // existentes.
  const fundResult = await fundAccountIfNeeded(pubkey);

  const { xdr, hashHex } = await buildTrustlineXdr(pubkey, issuerPubkey);
  return ok({ xdr, hashHex, funded: fundResult.funded }, { requestId });
});
