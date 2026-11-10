/**
 * Submit do swap (N1): corpo só `{ quoteId, signedXdr }`.
 *
 * Igual ao `postJson`, com uma diferença: o 409 `NAV_MUDOU` (o NAV mudou desde
 * a cotação, `swap/submit`) vira `NavMudouError` — a tela mostra mensagem fixa
 * e oferece recotar, em vez do texto genérico de incidente.
 */

import { unwrapEnvelope } from '@/lib/http/client';

export const NAV_MUDOU_MESSAGE = 'O NAV mudou; gere uma nova cotação';

export class NavMudouError extends Error {
  constructor() {
    super(NAV_MUDOU_MESSAGE);
    this.name = 'NavMudouError';
  }
}

export interface SwapSubmitBody {
  quoteId: string;
  signedXdr: string;
}

export async function submitSwap(
  body: SwapSubmitBody,
  getAccessToken: () => Promise<string | null>,
): Promise<{ swapTxHash: string }> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão Privy expirada.');
  const res = await fetch('/api/investidor/buy/swap/submit', {
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
    if (code === 'NAV_MUDOU') throw new NavMudouError();
  }
  return unwrapEnvelope<{ swapTxHash: string }>(res);
}
