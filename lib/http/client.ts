/**
 * Cliente HTTP browser-side dos hooks de /investir. Módulo puro (sem import de
 * `next/server` — distinto de `parse-body.ts` neste mesmo dir).
 *
 * Centraliza o boilerplate token→Bearer→!res.ok→json() que estava duplicado em
 * ~10 chamadas nos hooks de `app/investir/_hooks/`. Lança 'Sessão Privy
 * expirada.' se não houver token, e o texto do erro do server se !res.ok —
 * ambos capturados pelos try/catch dos hooks (asFlowError).
 *
 * Entende os DOIS envelopes (#8): o novo `{ data, error }` das rotas migradas
 * pro `withApi` e o legado `{ error: string }` / payload cru das demais. Assim
 * a migração rota-a-rota é transparente pros hooks.
 */

/**
 * Lê o body de `res` e desembrulha o envelope `{ data, error }` quando presente:
 * - envelope com `error` não-null → lança `Error(error.message)` (vira asFlowError);
 * - envelope com `error` null → retorna `data`;
 * - shape legado `{ error: string }` em `!res.ok` → lança `Error(string)`;
 * - payload cru → retorna como está.
 *
 * Reutilizável pelos pollers raw-fetch (sacar/lab) que não passam por
 * `postJson`/`getJson`.
 */
export async function unwrapEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Resposta não-JSON (ex.: erro de proxy/gateway) — superfície o texto cru.
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text as unknown as T;
  }

  // Envelope novo: sempre tem `data` e `error` (um deles null).
  if (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    'error' in body
  ) {
    const env = body as { data: T | null; error: { message?: string } | null };
    if (env.error) throw new Error(env.error.message ?? `HTTP ${res.status}`);
    return env.data as T;
  }

  // Shape legado `{ error: string }` ou payload cru.
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  getAccessToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão Privy expirada.');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return unwrapEnvelope<T>(res);
}

/** Variante GET do `postJson` — Bearer + !res.ok→throw. Usada pelos passos de
 *  leitura do wizard /comprar (lista de cotas, due diligence). */
export async function getJson<T>(
  url: string,
  getAccessToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão Privy expirada.');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrapEnvelope<T>(res);
}
