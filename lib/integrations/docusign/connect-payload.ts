/**
 * Leitura tolerante do corpo do DocuSign Connect (JSON): extrai só o `envelopeId`.
 * O status do corpo NÃO é usado como verdade — quem processa consulta a API
 * (`obterStatusEnvelope`). Aceita o formato SIM v2.1 (`data.envelopeId`) e o
 * legado (`envelopeId`). Devolve `null` se não achar um GUID.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extrairEnvelopeIdConnect(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as Record<string, unknown>;
  const data = c.data && typeof c.data === 'object' ? (c.data as Record<string, unknown>) : null;
  for (const candidato of [data?.envelopeId, c.envelopeId]) {
    if (typeof candidato === 'string' && GUID.test(candidato)) return candidato;
  }
  return null;
}
