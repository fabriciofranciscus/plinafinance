/**
 * Remove top-level keys que começam com `_` de um payload de auditoria
 * (N-17). Os campos canônicos (`_type`, `_at`, `_ref`) são injetados por
 * `buildAuditPayload` exclusivamente pra hash determinístico — não fazem
 * sentido pro consumidor da API e vazam shape interno se devolvidos crus.
 *
 * Strip é top-level only por design: o leak é o envelope canônico, não
 * dados aninhados. Valores objeto/array passam intactos.
 */
import type { Prisma } from '@prisma/client';

export function stripInternalKeys(
  payload: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const obj = payload as Record<string, Prisma.JsonValue>;
  const out: Record<string, Prisma.JsonValue> = {};
  for (const k of Object.keys(obj)) {
    if (!k.startsWith('_')) out[k] = obj[k]!;
  }
  return out;
}
