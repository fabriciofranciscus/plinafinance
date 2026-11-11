/**
 * Porta de webhook do anchor: o resto do app só vê `AnchorWebhookEvent` e
 * `verifyAnchorWebhook`; o formato da assinatura é detalhe do fornecedor.
 */

import {
  normalizeEtherfuseWebhook,
  verifyEtherfuseSignature,
} from './etherfuse/webhook';

/** Evento do anchor normalizado para o tipo interno (sem PII). */
export interface AnchorWebhookEvent {
  fornecedor: 'etherfuse';
  /** Chave de dedupe da entrega. */
  eventoId: string;
  tipo: string;
  /** Id do recurso afetado (customerId no KYC, orderId nas ordens…). */
  recursoId: string | null;
  status: string | null;
  /** Campos allowlisted para `WebhookEvento.payloadJson` (sem PII). */
  payload: Record<string, string | boolean | null>;
  /** Aviso ao usuário (`kyc_updated.userMessage`): só vai para a Pessoa, nunca para log nem WebhookEvento. */
  userMessage: string | null;
}

export type VerifyAnchorWebhookResult =
  | { ok: true; event: AnchorWebhookEvent }
  | { ok: false; reason: 'invalid_signature' | 'invalid_payload' };

/** Valida a assinatura e normaliza o corpo cru. Nunca lança. */
export function verifyAnchorWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): VerifyAnchorWebhookResult {
  if (!verifyEtherfuseSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }
  const event = normalizeEtherfuseWebhook(body);
  return event ? { ok: true, event } : { ok: false, reason: 'invalid_payload' };
}
