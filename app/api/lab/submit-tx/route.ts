/**
 * POST /api/lab/submit-tx
 *
 * Smoke endpoint pro /lab. Recebe `{xdr, signatureHex}` — pubkey vem do
 * JWT, não do body. Anexa signature e submete via Horizon. Devolve
 * `{hash}` da tx confirmada.
 *
 * C-07: gateado por LAB_ENABLED (testnet-only opt-in) + withAuth.
 * Auto-autoriza trustline server-side (só no /lab; em produção a Plina
 * decide quando autorizar após KYC).
 */

import { NextResponse } from 'next/server';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { logStellarError } from '@/lib/stellar/log-error';
import { withAuth } from '@/lib/wallet/auth-guard';
import { isLabEnabled } from '@/lib/env/lab';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  if (!isLabEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const { xdr, signatureHex } = (await req.json()) as {
      xdr?: string;
      signatureHex?: string;
    };
    if (!xdr || !signatureHex) {
      return NextResponse.json(
        { error: 'campos obrigatórios: xdr, signatureHex' },
        { status: 400 },
      );
    }

    const result = await submitWithPrivySignature({
      xdr,
      investorPubkey: user.publicKey,
      investorSignatureHex: signatureHex,
    });

    // Auto-autorizar a trustline pra ela aparecer como AUTHORIZED.
    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    if (issuerSecret) {
      try {
        await authorizeTrustline(issuerSecret, user.publicKey);
      } catch (authErr) {
        logStellarError('[lab] auto-autorização falhou (não-fatal):', authErr);
      }
    }

    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    logStellarError('[lab/submit-tx]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
