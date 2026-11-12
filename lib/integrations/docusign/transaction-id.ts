/**
 * transactionId determinístico para a DocuSign (idempotência de criarEnvelope).
 * Mesma chave de negócio (ex.: id da cessão + finalidade) → mesmo GUID, em qualquer retry.
 * A chave não é revertida do GUID (sha256); não use PII como chave.
 */

import { createHash } from 'node:crypto';

export function transactionIdDeterministico(chaveDeNegocio: string): string {
  if (!chaveDeNegocio) throw new Error('transactionIdDeterministico: chave vazia');
  const h = createHash('sha256').update(`plina:docusign:${chaveDeNegocio}`).digest('hex');
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
