/**
 * Pool service — composição, NAV e emissão.
 *
 * Whitepaper §6.4: PLINA-RF representa cota de FIDC. Modelo simplificado
 * pro POC (sem FIDC formal): 1 PLINA-RF = R$ 1,00 em direito creditório
 * ajustado pelo NAV de aquisição.
 *
 * Convenção POC:
 *   - NAV de cota = valor_carta × (1 - desagio_aquisicao). Ex: carta R$ 250k
 *     com 18% deságio → NAV R$ 205k.
 *   - Tokens emitidos por cota = NAV (1 PLINA-RF por BRL de NAV).
 *   - NAV total do pool = soma de NAV das cotas com status ∈ {DISPONIVEL, RESERVADA}.
 *     Cotas REALIZADA têm seus tokens queimados na realização; REVERTIDA idem.
 *   - Para POC, mantenho REALIZADA também no cálculo do `nav_realizado_acumulado`
 *     pro relatório histórico — mas é metric separada.
 *
 * Tipos `Decimal` do Prisma viram strings em runtime; aceito ambos via helper.
 */

import { Prisma, StatusCota } from '@prisma/client';

type Numericable = Prisma.Decimal | number | string;

function toNumber(value: Numericable): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

export interface CotaForNav {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
  tokensEmitidos: Numericable;
  status: StatusCota;
}

/** NAV em BRL de uma cota individual. */
export function navDaCota(cota: {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
}): number {
  const valor = toNumber(cota.valorCarta);
  const desagio = toNumber(cota.desagioAquisicao);
  return valor * (1 - desagio);
}

/** NAV total do pool, em BRL, considerando só cotas ativas. */
export function navTotalDoPool(cotas: CotaForNav[]): number {
  return cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce((sum, c) => sum + navDaCota(c), 0);
}

/** Soma de PLINA-RF emitidos vivos (cotas ativas). */
export function tokensEmitidosVivos(cotas: CotaForNav[]): number {
  return cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce((sum, c) => sum + toNumber(c.tokensEmitidos), 0);
}

/**
 * NAV por token. POC: 1 PLINA-RF = 1 BRL (paridade de emissão).
 * Mantida como função porque na Fase 1 NAV/token vira marcação real do FIDC.
 */
export function navPorToken(cotas: CotaForNav[]): number {
  const tokens = tokensEmitidosVivos(cotas);
  if (tokens === 0) return 0;
  return navTotalDoPool(cotas) / tokens;
}

/**
 * Quantidade de PLINA-RF a emitir ao incorporar uma cota nova.
 * POC: paridade NAV → 1 token por BRL de NAV.
 */
export function tokensParaEmitir(cota: {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
}): number {
  return Math.floor(navDaCota(cota));
}

// ─── Self-test inline (rodar com `tsx lib/services/pool.ts` se duvidar) ────
// Sem Vitest no POC ainda (decisão SPECS_MVP_TECH §6); inline checks por ora.
if (require.main === module) {
  const cota = { valorCarta: '250000', desagioAquisicao: '0.18' };
  const nav = navDaCota(cota);
  const expected = 205000;
  if (nav !== expected) {
    throw new Error(`navDaCota: esperado ${expected}, recebido ${nav}`);
  }
  console.log('✓ pool.ts inline self-test verde.');
}
