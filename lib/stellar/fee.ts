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

function stroops(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Oferta de fee (por op) dos builds ASSINADOS PELO INVESTIDOR: swap, resgate e claim (decisão do Atlas, 15/11;
 * achado 2 da Vera no E2 em produção). Num surto da testnet o p70 oscila entre ledgers e a tx montada com ele é
 * recusada ou fica na fila. Aqui a oferta é o p99 do `fee_charged` (nunca abaixo do p70), com piso BASE_FEE e
 * teto `MAX_FEE_STROOPS`. A rede cobra o preço efetivo do ledger (CAP-0005), não o máximo ofertado: fora de
 * surto o investidor continua pagando a base.
 * SEM cache: cada build lê o fee_stats de agora, então o "refazer" sai com a taxa nova. Horizon fora → cai no
 * `getDynamicFee` (que cai no BASE_FEE). O que a Plina paga (âncora, emissão, auditoria) segue no `getDynamicFee`.
 */
export async function getFeeOfertaInvestidor(): Promise<string> {
  try {
    const stats = await horizon.feeStats();
    const fc = (stats.fee_charged ?? {}) as unknown as Record<string, unknown>;
    const alvo = Math.max(stroops(fc.p99), stroops(fc.p70));
    const limitado = Math.max(Math.min(alvo, MAX_FEE_STROOPS), Number(BASE_FEE));
    return String(Math.round(limitado));
  } catch (err) {
    logStellarError('[stellar/fee] feeStats falhou na oferta do investidor — usando getDynamicFee:', err);
    return getDynamicFee();
  }
}

/**
 * Taxa base da rede agora (`last_ledger_base_fee`, por op): a régua do swap/submit (N1-S1(c)) para recusar,
 * ANTES de reservar, a tx que a rede recusaria com certeza. Não sobe em surto (o surto mexe no preço de inclusão,
 * não na base). Sem cache. Ausente, abaixo do protocolo ou Horizon fora → BASE_FEE.
 */
export async function getTaxaBaseDaRede(): Promise<string> {
  try {
    const stats = await horizon.feeStats();
    const base = stroops((stats as { last_ledger_base_fee?: unknown }).last_ledger_base_fee);
    return String(Math.max(Math.round(base), Number(BASE_FEE)));
  } catch (err) {
    logStellarError('[stellar/fee] feeStats falhou na taxa base — usando BASE_FEE:', err);
    return BASE_FEE;
  }
}

/** Testing only. */
export function _resetFeeCacheForTests(): void {
  cache = null;
}
