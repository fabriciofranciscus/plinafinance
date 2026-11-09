/**
 * POST /api/webhooks/anchor — entregas assinadas da Etherfuse (E2-2).
 *
 * Pública por design: a autenticação é a assinatura HMAC (`X-Signature`).
 * Sem assinatura válida → 401 sem ecoar nada. Idempotente por `eventoId`
 * (reentrega → 200 `duplicate`). Falha de processamento → 500 para o anchor
 * reentregar (a reentrega reprocessa, ver `processarWebhookAnchor`).
 *
 * Segredo: `ANCHOR_WEBHOOK_SECRET` (devolvido uma vez por `POST /ramp/webhook`).
 * Ausente → 503 fail-closed. Nunca loga corpo, header nem segredo.
 */

import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { verifyAnchorWebhook } from '@/lib/anchors/webhook';
import { processarWebhookAnchor } from '@/lib/services/webhook-anchor';
import { clientIp } from '@/lib/rate-limit/config';
import { createRateLimiter } from '@/lib/rate-limit/in-memory';

export const dynamic = 'force-dynamic';

/** Teto do corpo antes de calcular HMAC (eventos reais são pequenos). */
const MAX_BODY_BYTES = 256 * 1024;

// Limiter próprio de webhook (alto: o anchor reentrega em rajada).
const webhookLimiter = createRateLimiter({ limit: 300, windowMs: 60_000 });

export const POST = withApi(async (req, { requestId }) => {
  if (!(await webhookLimiter.consume(clientIp(req)))) {
    throw new ApiError('RATE_LIMITED', 429, 'Too Many Requests');
  }

  const secret = process.env.ANCHOR_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError('INTERNAL', 503, 'webhook indisponível');
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    throw new ApiError('VALIDATION_FAILED', 413, 'payload grande demais');
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError('VALIDATION_FAILED', 413, 'payload grande demais');
  }

  const result = verifyAnchorWebhook(rawBody, req.headers.get('x-signature'), secret);
  if (!result.ok) {
    if (result.reason === 'invalid_signature') {
      throw new ApiError('UNAUTHORIZED', 401, 'assinatura inválida');
    }
    throw new ApiError('VALIDATION_FAILED', 400, 'evento desconhecido');
  }

  const r = await processarWebhookAnchor(result.event);
  return ok(
    { received: true, duplicate: r.duplicado },
    { requestId },
  );
});
