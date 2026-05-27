/**
 * Rate-limiters compartilhados por categoria de rota (C-06).
 *
 * Backend é escolhido em runtime: Upstash Redis quando
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` estão setados
 * (produção/preview), in-memory caso contrário (dev/CI). Toda call site
 * deve usar `await limiter.consume(ip)` — `await <boolean>` é no-op no
 * fallback síncrono.
 */
import { createRateLimiter, clientIp, type RateLimiter } from './in-memory';
import { createUpstashRateLimiter, upstashEnabled } from './upstash';

function makeLimiter(
  prefix: string,
  limit: number,
  windowMs: number,
): RateLimiter {
  if (upstashEnabled()) {
    return createUpstashRateLimiter({ prefix, limit, windowMs });
  }
  return createRateLimiter({ limit, windowMs });
}

/** Rotas de captura de lead (públicas). Anti-bot agressivo. */
export const leadLimiter = makeLimiter('lead', 5, 60_000);

/** Rotas públicas genéricas (simular, summary etc). */
export const publicLimiter = makeLimiter('public', 20, 60_000);

/** Rotas autenticadas que disparam side effects custosos (Etherfuse, etc). */
export const sensitiveAuthLimiter = makeLimiter('sensitive', 10, 60_000);

/** Login admin (C-05). 5 tentativas / 15 min por IP. */
export const adminLoginLimiter = makeLimiter('admin-login', 5, 15 * 60_000);

export { clientIp };
