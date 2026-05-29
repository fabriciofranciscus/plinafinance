/**
 * Feature flags do PRD v1.0 (§M0, F-M0-6).
 *
 * Fonte canônica: Vercel Edge Config em produção. Fallback: process.env (dev/test).
 * Mantém inerte (`false`) até o cutover de cada módulo.
 *
 * Não importar diretamente de `@vercel/edge-config` aqui — fazemos lazy via
 * dynamic import pra não quebrar testes unit que não têm Edge Config token.
 */

type FlagName =
  | 'MAINNET_ENABLED'           // M9 — toggle de cutover canary
  | 'INTL_INVESTOR_FLOW'        // M4 — trilha internacional
  | 'SOROBAN_WATERFALL'         // M7 — waterfall on-chain
  | 'M3_INSTITUTIONAL_GATING';  // M3 — exige suitability + ticket mínimo em /quote

function readFromEnv(name: FlagName): boolean {
  return process.env[name] === 'true';
}

/**
 * Lê uma flag. Em prod tenta Edge Config primeiro; cai pra env se indisponível.
 * Em dev/test usa env direto.
 */
export async function getFlag(name: FlagName): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' || !process.env.EDGE_CONFIG) {
    return readFromEnv(name);
  }
  try {
    const { get } = await import('@vercel/edge-config');
    const value = await get<boolean>(name);
    return typeof value === 'boolean' ? value : readFromEnv(name);
  } catch {
    return readFromEnv(name);
  }
}

/** Versão síncrona — usa só env. Pra middleware/edge runtime. */
export function getFlagSync(name: FlagName): boolean {
  return readFromEnv(name);
}
