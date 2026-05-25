/**
 * Fee dinâmico via `Horizon.feeStats()` (audit F-15). BASE_FEE = 100 stroops
 * trava em congestionamento; p70 dos últimos 5 ledgers cobre 95% dos picos
 * sem overpay. Cap em 100_000 stroops é safety belt.
 *
 * Cache curto in-memory (5s) evita roundtrip HTTP a cada tx num burst.
 * Fluid Compute reusa a instância → cache "good enough" sem KV.
 * Fallback BASE_FEE em qualquer erro de Horizon — tx pode falhar de
 * congestionamento, mas o request nunca trava no feeStats.
 */

import { BASE_FEE } from '@stellar/stellar-sdk';
import { horizon } from './account';
import { logStellarError } from './log-error';

const MAX_FEE_STROOPS = 100_000;
const CACHE_TTL_MS = 5_000;

let cache: { value: string; expiresAt: number } | null = null;

export async function getDynamicFee(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  let value: string;
  try {
    const stats = await horizon.feeStats();
    const p70 = Number(stats.fee_charged?.p70 ?? BASE_FEE);
    const capped = Math.min(p70, MAX_FEE_STROOPS);
    const floored = Math.max(capped, Number(BASE_FEE));
    value = String(Math.round(floored));
  } catch (err) {
    logStellarError('[stellar/fee] feeStats falhou — usando BASE_FEE:', err);
    value = BASE_FEE;
  }
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Testing only. */
export function _resetFeeCacheForTests(): void {
  cache = null;
}
