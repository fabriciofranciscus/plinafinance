/**
 * POST /api/lab/submit-tx
 *
 * Smoke endpoint pro /lab. Recebe `{xdr, signatureHex}` — pubkey vem do
 * JWT, não do body. Anexa signature e submete via Horizon. Devolve
 * `{hash}` da tx confirmada.
 *
 * C-07: gateado por LAB_ENABLED (testnet-only opt-in) + auth.
 * Auto-autoriza trustline server-side (só no /lab; em produção a Plina
 * decide quando autorizar após KYC).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { issuerSigner } from '@/lib/stellar/signer';
import { logStellarError } from '@/lib/stellar/log-error';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { stellarSignatureHex, stellarXdr } from '@/lib/http/zod-stellar';
import { isLabEnabled } from '@/lib/env/lab';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    xdr: stellarXdr(),
    signatureHex: stellarSignatureHex(),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  if (!isLabEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const user = await requireInvestidor(req);
  const { xdr, signatureHex } = Schema.parse(await req.json());

  let result;
  try {
    result = await submitWithPrivySignature({
      xdr,
      investorPubkey: user.publicKey,
      investorSignatureHex: signatureHex,
    });
  } catch (err) {
    // Log redigido server-side (F-20); cliente recebe INTERNAL genérico.
    logStellarError('[lab/submit-tx]', err);
    throw err;
  }

  // Auto-autorizar a trustline pra ela aparecer como AUTHORIZED.
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (issuerSecret) {
    try {
      await authorizeTrustline(issuerSigner(), user.publicKey);
    } catch (authErr) {
      logStellarError('[lab] auto-autorização falhou (não-fatal):', authErr);
    }
  }

  return ok({ hash: result.hash }, { requestId });
});
