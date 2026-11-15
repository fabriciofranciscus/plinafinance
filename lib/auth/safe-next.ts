/**
 * Destino pós-login seguro (`/entrar?next=…`). Anti open redirect (Argus U1): o navegador trata `\` como `/`, então
 * `/\evil.com` e `/%5Cevil.com` viram `https://evil.com`. Regras: só caminho que começa com UM `/`; recusa `\`,
 * `%5C` e caracteres de controle (também percent-encoded); resolve com `new URL` e aceita só a MESMA origem,
 * devolvendo `pathname + search + hash` (nunca a string crua).
 */

const PERIGOSO = /[\u0000-\u001f\u007f\\]/;

export function safeNext(raw: string | null | undefined, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (PERIGOSO.test(raw)) return null;
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(raw);
  } catch {
    return null; // percent-encoding malformado
  }
  if (PERIGOSO.test(decodificado) || decodificado.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
