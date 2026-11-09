/**
 * Webhook da Etherfuse: verificação de assinatura + normalização do evento.
 *
 * Contrato (docs.etherfuse.com › guides/verifying-webhooks, v1):
 *   - header `X-Signature: sha256=<hex>`
 *   - HMAC-SHA256 sobre o JSON **canonicalizado** (RFC 8785), não sobre o corpo cru
 *   - segredo devolvido uma única vez por `POST /ramp/webhook`, em base64
 *     (a doc v2 fala em base64 URL-safe; o decoder do Node aceita os dois)
 *   - sem timestamp assinado e sem id de evento estável na v1 → dedupe por hash
 *     do corpo canônico (reentrega = mesmo corpo = mesmo hash)
 *
 * Nunca loga corpo nem segredo. O payload normalizado carrega só campos
 * allowlisted (sem PII).
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AnchorWebhookEvent } from '../webhook';

export const ETHERFUSE_WEBHOOK_EVENTS = [
  'bank_account_updated',
  'customer_updated',
  'order_updated',
  'quote_updated',
  'swap_updated',
  'kyc_updated',
  'kyb_updated',
] as const;

export type EtherfuseWebhookEvent = (typeof ETHERFUSE_WEBHOOK_EVENTS)[number];

/** Serialização canônica (RFC 8785): chaves ordenadas, sem espaços. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v === undefined ? null : v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * `true` só se o header bate com o HMAC do corpo canônico. Qualquer entrada
 * malformada (header ausente, hex inválido, JSON inválido, segredo vazio) → false.
 */
export function verifyEtherfuseSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim());
  if (!m) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const key = Buffer.from(secret, 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(canonicalizeJson(parsed)).digest();
  const received = Buffer.from(m[1], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/**
 * Normaliza o corpo (já com assinatura verificada). Envelope v1: um objeto com
 * uma única chave = tipo do evento, valor = entidade. Retorna `null` para forma
 * desconhecida (o chamador responde 400, sem ecoar o corpo).
 */
export function normalizeEtherfuseWebhook(body: unknown): AnchorWebhookEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const tipo = ETHERFUSE_WEBHOOK_EVENTS.find((t) => t in obj);
  if (!tipo) return null;
  const entity = obj[tipo];
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const e = entity as Record<string, unknown>;

  const recursoId =
    tipo === 'kyc_updated' || tipo === 'kyb_updated'
      ? (asString(e.customerId) ?? asString(e.organizationId) ?? asString(e.id))
      : (asString(e.id) ?? asString(e.orderId) ?? asString(e.customerId));
  const status = asString(e.status);

  const eventoId =
    asString(obj.eventId) ??
    `sha256:${createHash('sha256').update(canonicalizeJson(body)).digest('hex')}`;

  return {
    fornecedor: 'etherfuse',
    eventoId,
    tipo,
    recursoId,
    status,
    payload: {
      recursoId,
      status,
      approved: asBool(e.approved),
      needsWork: asBool(e.needsWork),
    },
    userMessage: asString(e.userMessage),
  };
}
