/**
 * POST /api/lab/submit-tx
 *
 * Smoke endpoint pro /lab. Recebe `{xdr, investorPubkey, signatureHex}` —
 * o signature foi gerado pelo Privy useSignRawHash no frontend.
 *
 * Anexa signature em base64 no envelope e submete via Horizon. Devolve
 * `{hash}` da tx confirmada.
 *
 * Em produção, autorizar trustline (issuer side) é chamada separada após
 * Plina aprovar o investidor — aqui no /lab, faço a autorização automática
 * pra trustline aparecer como AUTHORIZED no Stellar Expert.
 */

import { NextResponse } from 'next/server';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { xdr, investorPubkey, signatureHex } = (await req.json()) as {
      xdr?: string;
      investorPubkey?: string;
      signatureHex?: string;
    };
    if (!xdr || !investorPubkey || !signatureHex) {
      return NextResponse.json(
        { error: 'campos obrigatórios: xdr, investorPubkey, signatureHex' },
        { status: 400 },
      );
    }

    const result = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });

    // Auto-autorizar a trustline pra ela aparecer como AUTHORIZED.
    // (Em produção a Plina decide quando autorizar, após KYC + compliance.)
    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    if (issuerSecret) {
      try {
        await authorizeTrustline(issuerSecret, investorPubkey);
      } catch (authErr) {
        console.warn('[lab] auto-autorização falhou (não-fatal):', authErr);
      }
    }

    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
