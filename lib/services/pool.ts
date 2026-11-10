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
 *   - NAV total do pool = NAV das cotas ativas + caixa realizado. É o lado do
 *     **ativo**, e não depende do ledger.
 *   - Denominador do NAV/token = supply **circulante lido do ledger**
 *     (`lib/stellar/supply.ts`), nunca o estado da aplicação. Até 2026-11 o
 *     denominador eram os `tokensEmitidos` das cotas ativas, o que fazia a
 *     cota realizada sair do denominador enquanto seu caixa entrava no
 *     numerador — dupla contagem — e colapsava o NAV a zero em runoff.
 *   - Tesouraria (token cunhado e ainda no distributor) é **deduzida ao par**
 *     do ativo. Token em tesouraria não é passivo com investidor, mas foi
 *     cunhado em paridade contra ativo que já está no numerador; sem a
 *     dedução, incorporar uma cota inflaria o NAV de quem já é holder.
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

/**
 * Soma de PLINA-RF emitidos contra cotas ativas.
 *
 * **Não é o denominador do NAV** — ver a convenção no topo do arquivo. Segue
 * exposto porque é a métrica honesta de "quanto token tem lastro de cota viva
 * agora", útil no painel operacional ao lado do supply do ledger: a diferença
 * entre os dois é exatamente o quanto do passivo já está coberto por caixa em
 * vez de cota.
 */
export function tokensEmitidosVivos(cotas: CotaForNav[]): number {
  return tokensEmitidosVivosAsDecimal(cotas).toNumber();
}

/**
 * Supply lido do ledger, na forma mínima que o cálculo precisa.
 *
 * Tipo estrutural de propósito: `pool.ts` é aritmética pura e não importa
 * nada de `lib/stellar/`. O `SupplyOnChain` de `lib/stellar/supply.ts`
 * satisfaz esta interface, e os testes passam números literais.
 */
export interface SupplyParaNav {
  /** Token em mãos de investidor. Denominador do NAV. */
  circulante: Numericable;
  /** Token cunhado e ainda no distributor. */
  tesouraria: Numericable;
}

/**
 * Ativo do fundo atribuível a quem detém token: NAV total menos a tesouraria
 * ao par. Ver a convenção no topo do arquivo para o porquê da dedução.
 */
export function navAtribuivelAsDecimal(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[],
  supply: SupplyParaNav,
): Prisma.Decimal {
  return navTotalDoPoolAsDecimal(cotas, realizacoes).minus(
    toDecimal(supply.tesouraria),
  );
}

/** Ativo atribuível em BRL. */
export function navAtribuivel(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[],
  supply: SupplyParaNav,
): number {
  return navAtribuivelAsDecimal(cotas, realizacoes, supply).toNumber();
}

export function navPorTokenAsDecimal(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[],
  supply: SupplyParaNav,
): Prisma.Decimal {
  const circulante = toDecimal(supply.circulante);
  // Nada em mãos de investidor: não há passivo a precificar. Diferente do
  // runoff — lá o circulante é > 0 e o NAV vem do caixa.
  if (circulante.lte(0)) return new Prisma.Decimal(0);
  return navAtribuivelAsDecimal(cotas, realizacoes, supply)
    .div(circulante)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
}

/**
 * NAV por token, precificado contra o supply circulante do ledger.
 *
 * NAV/token > 1 sinaliza yield acumulado pelo fundo. Em runoff — todas as
 * cotas realizadas, caixa no lugar delas — o número **continua válido**:
 * passa a ser caixa / circulante, que é exatamente o que um investidor
 * liquidando deve receber.
 *
 * `supply` é obrigatório por decisão de tipo: o denominador errado é o bug
 * que este cálculo existe pra eliminar, e um parâmetro opcional deixaria a
 * regressão voltar em silêncio.
 */
export function navPorToken(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[],
  supply: SupplyParaNav,
): number {
  return navPorTokenAsDecimal(cotas, realizacoes, supply).toNumber();
}

/** NAV/token inicial: com supply circulante zero o token vale R$ 1,00 (ADR 2026-11-09, cond. 5). */
export const NAV_INICIAL_POR_TOKEN = new Prisma.Decimal(1);

/**
 * NAV/token a usar na emissão. Supply circulante zero → R$ 1,00 (a 1ª emissão
 * reproduz a prova do SOW: R$ 400 → 400 tokens). Com circulante > 0 vale o NAV
 * do ledger (mesma função da tela e do resgate); NAV não positivo lança —
 * sem preço honesto não se emite.
 */
export function navParaEmissao(
  cotas: CotaForNav[],
  realizacoes: RealizacaoForNav[],
  supply: SupplyParaNav,
): Prisma.Decimal {
  if (toDecimal(supply.circulante).lte(0)) return NAV_INICIAL_POR_TOKEN;
  const nav = navPorTokenAsDecimal(cotas, realizacoes, supply);
  if (nav.lte(0)) {
    throw new RangeError('NAV/token não positivo: emissão recusada');
  }
  return nav;
}

/**
 * Quantidade de PLINA-RF emitida para `valorBrl` integralizado ao NAV/token
 * dado: `valorBrl ÷ navPorToken`, **truncada** (ROUND_DOWN) a 7 casas — a
 * precisão do Stellar. Nunca emite mais do que o BRL pago compra, e o NAV de
 * quem já é holder não cai com a emissão (R$ 400 a NAV 1,0625 → 376,4705882).
 * Fórmula única para incorporação e subscrição. NAV ≤ 0 ou valor < 0 lança.
 */
export function quantidadeEmitida(
  valorBrl: Numericable,
  navPorToken: Numericable,
): Prisma.Decimal {
  const valor = toDecimal(valorBrl);
  const nav = toDecimal(navPorToken);
  if (!nav.gt(0)) throw new RangeError('navPorToken deve ser > 0');
  if (valor.lt(0)) throw new RangeError('valorBrl não pode ser negativo');
  return valor.div(nav).toDecimalPlaces(7, Prisma.Decimal.ROUND_DOWN);
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
