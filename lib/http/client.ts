/**
 * Cliente HTTP browser-side dos hooks de /investir. Módulo puro (sem import de
 * `next/server` — distinto de `parse-body.ts` neste mesmo dir).
 *
 * Centraliza o boilerplate token→Bearer→!res.ok→json() que estava duplicado em
 * ~10 chamadas nos hooks de `app/investir/_hooks/`. Lança 'Sessão Privy
 * expirada.' se não houver token, e o texto do erro do server se !res.ok —
 * ambos capturados pelos try/catch dos hooks (asFlowError).
 */
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
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}
