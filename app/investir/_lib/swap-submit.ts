/**
 * Submit do swap (N1): corpo só `{ quoteId, signedXdr }`.
 *
 * Igual ao `postJson`, com uma diferença: o 409 `NAV_MUDOU` (o NAV mudou desde
 * a cotação, `swap/submit`) vira `NavMudouError` — a tela mostra mensagem fixa
 * e oferece recotar, em vez do texto genérico de incidente. O 410 (quote
 * expirou entre o build e o submit) vira `CotacaoExpiradaError`: mesma saída,
 * refazer o build (o servidor emite um quote novo).
 */

import { unwrapEnvelope } from '@/lib/http/client';

export const NAV_MUDOU_MESSAGE = 'O NAV mudou; gere uma nova cotação';

export const COTACAO_EXPIRADA_MESSAGE = 'A cotação expirou; gere uma nova cotação';

export class CotacaoExpiradaError extends Error {
  constructor() {
    super(COTACAO_EXPIRADA_MESSAGE);
    this.name = 'CotacaoExpiradaError';
  }
}

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
  if (res.status === 410) throw new CotacaoExpiradaError();
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
