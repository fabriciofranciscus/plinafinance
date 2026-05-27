/**
 * Rate limit in-memory por chave (default: IP). Token bucket simples.
 *
 * Escopo: rotas públicas pré-auth (`/api/vender/simular` etc.) que precisam
 * de barreira contra reconnaissance/spam mas não podem exigir Bearer token.
 *
 * Limitações conhecidas:
 *  - Estado vive em memória do processo. Fluid Compute reutiliza instâncias,
 *    então é "good enough" pra pico baixo. Produção real → Vercel KV/Upstash.
 *  - Não compartilha entre regiões/instâncias.
 *  - LRU naïve via Map insertion order; sem TTL ativo, só limpeza on-read.
 *
 * Uso:
 *   const rl = createRateLimiter({ limit: 20, windowMs: 60_000 });
 *   if (!rl.consume(clientIp(req))) return new Response('Too Many Requests', { status: 429 });
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /**
   * Retorna `true` se a request está dentro do limite. Promise quando o
   * backend é remoto (Upstash); valor síncrono quando in-memory. Call sites
   * devem usar `await` — `await <boolean>` é no-op.
   */
  consume(key: string): boolean | Promise<boolean>;
  reset(key?: string): void | Promise<void>;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Max chaves mantidas em memória. LRU naïve via Map insertion order. */
  maxKeys?: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const maxKeys = opts.maxKeys ?? 10_000;
  // E2E stub: bypass total. Specs disparam dezenas de requests/min do
  // mesmo IP localhost, batem no limiter (10/min) e quebram. Bypass só
  // ativa com `PRIVY_VERIFY_STUB=true` (env de CI). Branch morto em prod.
  const bypass = process.env.PRIVY_VERIFY_STUB === 'true';

  return {
    consume(key: string): boolean {
      if (bypass) return true;
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + opts.windowMs };
      }
      bucket.count += 1;
      buckets.delete(key);
      buckets.set(key, bucket);
      if (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      return bucket.count <= opts.limit;
    },
    reset(key?: string) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}

/**
 * Extrai IP do cliente em ambiente Vercel/Next.
 * Headers de proxy → fallback pra "unknown" (que ainda dá rate-limit, mas
 * agregado entre todos os requests sem header — comportamento conservador).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
