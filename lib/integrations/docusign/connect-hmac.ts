/**
 * Verificação de assinatura do DocuSign Connect (webhook).
 *
 * O Connect envia `X-DocuSign-Signature-N` = base64(HMAC-SHA256(chave, corpoBruto)).
 * Pode haver mais de uma (rotação de chave): basta uma válida. A comparação é em
 * tempo constante. O uso (rota de webhook + dedup) entra na DS3.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

type Cabecalhos =
  | Headers
  | Record<string, string | string[] | undefined>;

const PREFIXO = 'x-docusign-signature-';

function assinaturasRecebidas(headers: Cabecalhos): string[] {
  const out: string[] = [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((valor, nome) => {
      if (nome.toLowerCase().startsWith(PREFIXO)) out.push(valor);
    });
    return out;
  }
  for (const [nome, valor] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (!nome.toLowerCase().startsWith(PREFIXO) || valor === undefined) continue;
    if (Array.isArray(valor)) out.push(...valor);
    else out.push(valor);
  }
  return out;
}

export function verificarHmacConnect(
  rawBody: Buffer | string,
  headers: Cabecalhos,
  chave: string,
): boolean {
  if (!chave) return false;
  const esperado = createHmac('sha256', chave).update(rawBody).digest();

  let valido = false;
  for (const bruto of assinaturasRecebidas(headers)) {
    const recebido = Buffer.from(bruto.trim(), 'base64');
    // Tamanho não é segredo; timingSafeEqual exige tamanhos iguais.
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) {
      valido = true; // sem return antecipado: percorre todas
    }
  }
  return valido;
}
