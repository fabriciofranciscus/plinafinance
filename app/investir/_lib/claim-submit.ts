/**
 * Submit do claim (E2-3). Igual ao `postJson`, mas o 409 `XDR_EXPIRADO` (o
 * Horizon recusou com `tx_too_late`) vira `ClaimXdrExpiradoError`: o hook
 * refaz o build — o servidor regenera o XDR — e pede nova assinatura.
 */

import { unwrapEnvelope } from '@/lib/http/client';

export const CLAIM_XDR_EXPIRADO_MESSAGE =
  'A transação de resgate expirou. Tente novamente para gerar uma nova.';

export class ClaimXdrExpiradoError extends Error {
  constructor() {
    super(CLAIM_XDR_EXPIRADO_MESSAGE);
    this.name = 'ClaimXdrExpiradoError';
  }
}

export interface ClaimSubmitBody {
  orderId: string;
  xdr: string;
  signatureHex: string;
}

export async function submitClaim(
  body: ClaimSubmitBody,
  getAccessToken: () => Promise<string | null>,
): Promise<{ claimTxHash: string }> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão Privy expirada.');
  const res = await fetch('/api/investidor/buy/claim/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const j = (await res
      .clone()
      .json()
      .catch(() => null)) as {
      code?: string;
      error?: { code?: string } | string | null;
    } | null;
    const code =
      j?.code ?? (j && typeof j.error === 'object' ? j.error?.code : undefined);
    if (code === 'XDR_EXPIRADO') throw new ClaimXdrExpiradoError();
  }
  return unwrapEnvelope<{ claimTxHash: string }>(res);
}
