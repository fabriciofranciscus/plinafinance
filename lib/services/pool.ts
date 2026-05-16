/**
 * Pool service — composição, NAV e emissão.
 *
 * Whitepaper §5/§6.4: PLINA-RF representa cota de FIDC. 1 PLINA-RF = R$ 1,00
 * em direito creditório ajustado diariamente pelo NAV.
 *
 * Convenção:
 *   - NAV de cota ativa = valor_carta × (1 - desagio_aquisicao).
 *   - Caixa realizado = soma de `valorRealizado` das cotas que saíram do pool
 *     (Caminho A/B/C executados). Esse caixa **pertence ao fundo** — o spread
 *     fica como yield acumulado, materializando o §6.2 (Caminho A como fonte
 *     primária de yield).
 *   - NAV total do pool = NAV das cotas ativas + caixa realizado.
 *   - Tokens vivos = tokens emitidos das cotas ativas (denominador inalterado
 *     pra refletir lastro corrente; quando uma cota é realizada, seus tokens
 *     "saem" mas o caixa toma o lugar — NAV/token sobe pelo spread).
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

export interface RealizacaoForNav {
  valorRealizado: Numericable;
  spread?: Numericable;
}

/**
 * Caixa do fundo proveniente de cotas já realizadas. Soma `valorRealizado`
 * (preço pago pelo comprador-usuário, incluindo o custo de aquisição + spread).
 * É o que sobra como cash do fundo depois que a cota saiu do pool de ativos.
 */
export function caixaRealizado(realizacoes: RealizacaoForNav[]): number {
  return realizacoes.reduce((sum, r) => sum + toNumber(r.valorRealizado), 0);
}

/** Yield realizado acumulado (apenas a parte de spread). */
export function spreadRealizadoAcumulado(realizacoes: RealizacaoForNav[]): number {
  return realizacoes.reduce(
    (sum, r) => sum + (r.spread !== undefined ? toNumber(r.spread) : 0),
    0,
  );
}

/**
 * NAV total do fundo em BRL = NAV das cotas ativas + caixa realizado.
 * O 2º argumento é opcional — se omitido, retorna apenas o NAV das cotas
 * ativas (uso retrocompatível). Para visão correta do fundo, passe sempre
 * `realizacoes`.
 */
export function navTotalDoPool(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[] = [],
): number {
  const navAtivo = cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce((sum, c) => sum + navDaCota(c), 0);
  return navAtivo + caixaRealizado(realizacoes);
}

/** Soma de PLINA-RF emitidos vivos (cotas ativas). */
export function tokensEmitidosVivos(cotas: CotaForNav[]): number {
  return cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce((sum, c) => sum + toNumber(c.tokensEmitidos), 0);
}

/**
 * NAV por token. Incluindo caixa realizado, NAV/token > 1 sinaliza yield
 * acumulado pelo fundo. Sem cotas vivas mas com caixa, retorna 0 (pool
 * em runoff — todas as cotas foram realizadas e os investidores devem
 * liquidar).
 */
export function navPorToken(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[] = [],
): number {
  const tokens = tokensEmitidosVivos(cotas);
  if (tokens === 0) return 0;
  return navTotalDoPool(cotas, realizacoes) / tokens;
}

/**
 * Concentração por administradora (apenas cotas ativas). Útil pro painel
 * operacional flagrar exposição > 40% (limite POC; whitepaper §5 exige
 * "mínima diversificação por administradora").
 */
export function concentracaoPorAdministradora(
  cotas: (CotaForNav & { administradora: string })[],
): { administradora: string; nav: number; pct: number; alerta: boolean }[] {
  const ativas = cotas.filter(
    (c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA',
  );
  const totalNav = ativas.reduce((sum, c) => sum + navDaCota(c), 0);
  if (totalNav === 0) return [];
  const byAdmin = new Map<string, number>();
  for (const c of ativas) {
    byAdmin.set(c.administradora, (byAdmin.get(c.administradora) ?? 0) + navDaCota(c));
  }
  return Array.from(byAdmin.entries())
    .map(([administradora, nav]) => {
      const pct = (nav / totalNav) * 100;
      return { administradora, nav, pct, alerta: pct > 40 };
    })
    .sort((a, b) => b.nav - a.nav);
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
