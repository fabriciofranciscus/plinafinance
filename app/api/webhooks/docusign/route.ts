/**
 * POST /api/webhooks/docusign — DocuSign Connect (DS3).
 *
 * Pública por desenho; a autenticação é o HMAC (`X-DocuSign-Signature-N`) sobre o
 * corpo BRUTO, comparação em tempo constante. Sem chave configurada → 503 (fail-closed);
 * sem assinatura válida → 401 sem eco do corpo. O corpo NÃO é fonte de verdade: só o
 * `envelopeId` é usado, e o status é relido na API do DocuSign.
 *
 * Idempotente por estado da cessão (reentrega → 200). Falha de processamento →
 * 500 sem mensagem, para o Connect reentregar; o polling do /admin também cobre.
 */

import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { extrairEnvelopeIdConnect, verificarHmacConnect } from '@/lib/integrations/docusign';
import { processarEnvelopeDocusign } from '@/lib/services/cessao-assinatura';
import { clientIp } from '@/lib/rate-limit/config';
import { createRateLimiter } from '@/lib/rate-limit/in-memory';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512 * 1024;
const limiter = createRateLimiter({ limit: 300, windowMs: 60_000 });

export const POST = withApi(async (req, { requestId }) => {
  if (!(await limiter.consume(clientIp(req)))) {
    throw new ApiError('RATE_LIMITED', 429, 'Too Many Requests');
  }
  const chave = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
  if (!chave) throw new ApiError('INTERNAL', 503, 'webhook indisponível');

  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    throw new ApiError('VALIDATION_FAILED', 413, 'payload grande demais');
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError('VALIDATION_FAILED', 413, 'payload grande demais');
  }
  if (!verificarHmacConnect(raw, req.headers, chave)) {
    throw new ApiError('UNAUTHORIZED', 401, 'assinatura inválida');
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_FAILED', 400, 'evento inválido');
  }
  const envelopeId = extrairEnvelopeIdConnect(corpo);
  if (!envelopeId) throw new ApiError('VALIDATION_FAILED', 400, 'evento desconhecido');

  const r = await processarEnvelopeDocusign(envelopeId, 'docusign-webhook');
  return ok({ received: true, resultado: r.resultado }, { requestId });
});
