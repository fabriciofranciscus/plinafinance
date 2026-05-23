/**
 * Rate-limiters compartilhados por categoria de rota (C-06).
 *
 * Cada limiter é singleton de módulo. Fluid Compute reusa instância
 * entre invocações da mesma região, então o bucket sobrevive entre
 * requests. Produção real → Upstash/KV.
 */
import { createRateLimiter, clientIp } from './in-memory';

/** Rotas de captura de lead (públicas). Anti-bot agressivo. */
export const leadLimiter = createRateLimiter({
  limit: 5,
  windowMs: 60_000,
});

/** Rotas públicas genéricas (simular, summary etc). */
export const publicLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60_000,
});

/** Rotas autenticadas que disparam side effects custosos (Etherfuse, etc). */
export const sensitiveAuthLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60_000,
});

export { clientIp };
