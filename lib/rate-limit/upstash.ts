/**
 * Adapter Upstash Redis sliding-window. Compartilha estado entre instâncias
 * Fluid Compute / regiões, fechando o gap declarado em `in-memory.ts`.
 *
 * Habilitado quando UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN estão
 * setados. Sem env vars, `config.ts` cai no fallback in-memory (dev/CI).
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import type { RateLimiter, RateLimiterOptions } from './in-memory';

let cachedRedis: Redis | null = null;

function getRedis(): Redis {
  if (cachedRedis) return cachedRedis;
  cachedRedis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return cachedRedis;
}

export function upstashEnabled(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

export function createUpstashRateLimiter(
  opts: RateLimiterOptions & { prefix: string },
): RateLimiter {
  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowMs} ms`),
    prefix: `plina:rl:${opts.prefix}`,
    analytics: false,
  });

  return {
    async consume(key: string): Promise<boolean> {
      const { success } = await limiter.limit(key);
      return success;
    },
    async reset(key?: string) {
      if (key === undefined) return;
      // Upstash não oferece "reset all"; reset por chave é o que call sites usam
      // (admin login após sucesso — `loginRateLimiter.reset(ip)`).
      await getRedis().del(`plina:rl:${opts.prefix}:${key}`);
    },
  };
}
