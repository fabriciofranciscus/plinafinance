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
 * Aritmética interna em `Prisma.Decimal` (audit F-10): valores R$10M+ com
 * desagio fracionário perdem centavos em IEEE-754. Funções públicas retornam
 * `number` pra compatibilidade com UI/JSON; callers que persistem ou compõem
 * precisão crítica devem usar as variantes `*AsDecimal`.
 */

import { Prisma, StatusCota } from '@prisma/client';

type Numericable = Prisma.Decimal | number | string;

function toDecimal(value: Numericable): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

export interface CotaForNav {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
  tokensEmitidos: Numericable;
  status: StatusCota;
}

const ONE = new Prisma.Decimal(1);

export function navDaCotaAsDecimal(cota: {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
}): Prisma.Decimal {
  return toDecimal(cota.valorCarta)
    .mul(ONE.minus(toDecimal(cota.desagioAquisicao)))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
}

/** NAV em BRL de uma cota individual. */
export function navDaCota(cota: {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
}): number {
  return navDaCotaAsDecimal(cota).toNumber();
}

export interface RealizacaoForNav {
  valorRealizado: Numericable;
  spread?: Numericable;
}

export function caixaRealizadoAsDecimal(
  realizacoes: RealizacaoForNav[],
): Prisma.Decimal {
  return realizacoes.reduce(
    (sum, r) => sum.plus(toDecimal(r.valorRealizado)),
    new Prisma.Decimal(0),
  );
}

/**
 * Caixa do fundo proveniente de cotas já realizadas. Soma `valorRealizado`
 * (preço pago pelo comprador-usuário, incluindo o custo de aquisição + spread).
 * É o que sobra como cash do fundo depois que a cota saiu do pool de ativos.
 */
export function caixaRealizado(realizacoes: RealizacaoForNav[]): number {
  return caixaRealizadoAsDecimal(realizacoes).toNumber();
}

export function spreadRealizadoAcumuladoAsDecimal(
  realizacoes: RealizacaoForNav[],
): Prisma.Decimal {
  return realizacoes.reduce(
    (sum, r) =>
      sum.plus(r.spread !== undefined ? toDecimal(r.spread) : new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
}

/** Yield realizado acumulado (apenas a parte de spread). */
export function spreadRealizadoAcumulado(realizacoes: RealizacaoForNav[]): number {
  return spreadRealizadoAcumuladoAsDecimal(realizacoes).toNumber();
}

export function navTotalDoPoolAsDecimal(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[] = [],
): Prisma.Decimal {
  const navAtivo = cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce((sum, c) => sum.plus(navDaCotaAsDecimal(c)), new Prisma.Decimal(0));
  return navAtivo.plus(caixaRealizadoAsDecimal(realizacoes));
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
  return navTotalDoPoolAsDecimal(cotas, realizacoes).toNumber();
}

export function tokensEmitidosVivosAsDecimal(
  cotas: CotaForNav[],
): Prisma.Decimal {
  return cotas
    .filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA')
    .reduce(
      (sum, c) => sum.plus(toDecimal(c.tokensEmitidos)),
      new Prisma.Decimal(0),
    );
}

/** Soma de PLINA-RF emitidos vivos (cotas ativas). */
export function tokensEmitidosVivos(cotas: CotaForNav[]): number {
  return tokensEmitidosVivosAsDecimal(cotas).toNumber();
}

export function navPorTokenAsDecimal(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[] = [],
): Prisma.Decimal {
  const tokens = tokensEmitidosVivosAsDecimal(cotas);
  if (tokens.isZero()) return new Prisma.Decimal(0);
  return navTotalDoPoolAsDecimal(cotas, realizacoes)
    .div(tokens)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
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
  return navPorTokenAsDecimal(cotas, realizacoes).toNumber();
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
  const totalNav = ativas.reduce(
    (sum, c) => sum.plus(navDaCotaAsDecimal(c)),
    new Prisma.Decimal(0),
  );
  if (totalNav.isZero()) return [];
  const byAdmin = new Map<string, Prisma.Decimal>();
  for (const c of ativas) {
    const prev = byAdmin.get(c.administradora) ?? new Prisma.Decimal(0);
    byAdmin.set(c.administradora, prev.plus(navDaCotaAsDecimal(c)));
  }
  return Array.from(byAdmin.entries())
    .map(([administradora, nav]) => {
      const pct = nav.div(totalNav).mul(100);
      return {
        administradora,
        nav: nav.toNumber(),
        pct: pct.toNumber(),
        alerta: pct.gt(40),
      };
    })
    .sort((a, b) => b.nav - a.nav);
}

/**
 * Quantidade de PLINA-RF a emitir ao incorporar uma cota nova.
 * POC: paridade NAV → 1 token por BRL de NAV (truncado a inteiros).
 */
export function tokensParaEmitir(cota: {
  valorCarta: Numericable;
  desagioAquisicao: Numericable;
}): number {
  return navDaCotaAsDecimal(cota)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)
    .toNumber();
}
