/**
 * Razão mínimo do fundo (E2-5). O caixa do NAV vem daqui — soma de
 * `MovimentoFundo.deltaCaixa` — e não mais de `RealizacaoCaminho`: cada real
 * entra no numerador por UM evento (subscrição, realização…), e saída de caixa
 * (aquisição, resgate pago) tem lugar próprio.
 *
 * Idempotente por `chave` (`createMany skipDuplicates`: não aborta a transação
 * em reenvio). Append-only: este módulo só insere.
 */

import { Prisma, type TipoMovimentoFundo } from '@prisma/client';
import { db } from '../db';
import type { RealizacaoForNav } from './pool';

type Client = Pick<typeof db, 'movimentoFundo'>;

export interface MovimentoFundoInput {
  tipo: TipoMovimentoFundo;
  /** BRL do evento, ≥ 0. O sinal do caixa é decidido pelo tipo. */
  valorBrl: Prisma.Decimal | string | number;
  /** Tokens emitidos (+) ou queimados (−) pelo evento, em valor absoluto. */
  tokens?: Prisma.Decimal | string | number;
  chave: string;
  cotaId?: string;
  quoteId?: string;
  refHash?: string;
}

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/** Efeito de cada tipo no caixa e nos tokens (única fonte dessa regra). */
function efeitos(tipo: TipoMovimentoFundo, valor: Prisma.Decimal, tokens: Prisma.Decimal) {
  const zero = D(0);
  switch (tipo) {
    case 'SUBSCRICAO':
      return { deltaCaixa: valor, deltaTokens: tokens };
    case 'APORTE_COTA':
      return { deltaCaixa: zero, deltaTokens: tokens };
    case 'AQUISICAO':
      return { deltaCaixa: valor.neg(), deltaTokens: zero };
    case 'REALIZACAO':
      return { deltaCaixa: valor, deltaTokens: zero };
    case 'RESGATE_PAGO':
      return { deltaCaixa: valor.neg(), deltaTokens: tokens.neg() };
  }
}

/**
 * Registra um movimento. Reenvio com a mesma `chave` é no-op (retorna
 * `criado: false`). Lança se valor/tokens forem negativos ou se o tipo exigir
 * tokens e não vierem (emissão/queima sem quantidade quebraria o razão).
 */
export async function registrarMovimentoFundo(
  client: Client,
  input: MovimentoFundoInput,
): Promise<{ criado: boolean }> {
  const valor = D(input.valorBrl);
  const tokens = D(input.tokens ?? 0);
  if (valor.lt(0) || tokens.lt(0)) {
    throw new RangeError('valorBrl e tokens devem ser ≥ 0');
  }
  if (!input.chave) throw new RangeError('chave obrigatória');
  const exigeTokens =
    input.tipo === 'SUBSCRICAO' || input.tipo === 'APORTE_COTA' || input.tipo === 'RESGATE_PAGO';
  if (exigeTokens && !tokens.gt(0)) {
    throw new RangeError(`${input.tipo} exige tokens > 0`);
  }
  if (input.tipo === 'AQUISICAO' && tokens.gt(0)) {
    throw new RangeError('AQUISICAO não emite token');
  }
  const { deltaCaixa, deltaTokens } = efeitos(input.tipo, valor, tokens);
  const r = await client.movimentoFundo.createMany({
    data: [
      {
        tipo: input.tipo,
        valorBrl: valor,
        deltaCaixa,
        deltaTokens,
        chave: input.chave,
        cotaId: input.cotaId ?? null,
        quoteId: input.quoteId ?? null,
        refHash: input.refHash ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return { criado: r.count === 1 };
}

/** Caixa do fundo = soma do efeito de caixa de todos os movimentos. */
export async function caixaDoFundo(client: Client = db): Promise<Prisma.Decimal> {
  const agg = await client.movimentoFundo.aggregate({ _sum: { deltaCaixa: true } });
  return agg._sum.deltaCaixa ?? D(0);
}

/**
 * Caixa do razão na forma que as funções puras de NAV (`pool.ts`) já aceitam:
 * uma única "realização" cujo `valorRealizado` é o caixa. Mantém `pool.ts`
 * como aritmética pura e os testes existentes intactos.
 */
export async function caixaParaNav(client: Client = db): Promise<RealizacaoForNav[]> {
  return [{ valorRealizado: await caixaDoFundo(client), spread: 0 }];
}

/**
 * Backfill idempotente, espelho do SQL da migration (mesmas chaves): realizações
 * → REALIZACAO; cotas já incorporadas → APORTE_COTA pelo custo, q = tokens
 * já cunhados. Para reexecutar em ambiente que recebeu dados depois da migration.
 */
export async function backfillMovimentosFundo(
  client: Pick<typeof db, 'movimentoFundo' | 'realizacaoCaminho' | 'cota'>,
): Promise<{ realizacoes: number; aportes: number }> {
  const [realizacoes, cotas] = await Promise.all([
    client.realizacaoCaminho.findMany({
      select: { id: true, cotaId: true, valorRealizado: true, onChainTxHash: true },
    }),
    client.cota.findMany({
      where: { emissaoTxHash: { not: null }, tokensEmitidos: { gt: 0 } },
      select: {
        id: true,
        valorCarta: true,
        desagioAquisicao: true,
        tokensEmitidos: true,
        emissaoTxHash: true,
        hashValidacao: true,
      },
    }),
  ]);
  let r = 0;
  let a = 0;
  for (const x of realizacoes) {
    const { criado } = await registrarMovimentoFundo(client, {
      tipo: 'REALIZACAO',
      valorBrl: x.valorRealizado,
      chave: `realizacao:${x.id}`,
      cotaId: x.cotaId,
      refHash: x.onChainTxHash ?? undefined,
    });
    if (criado) r++;
  }
  for (const c of cotas) {
    const custo = D(c.valorCarta)
      .mul(D(1).minus(D(c.desagioAquisicao)))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    const { criado } = await registrarMovimentoFundo(client, {
      tipo: 'APORTE_COTA',
      valorBrl: custo,
      tokens: c.tokensEmitidos,
      chave: `aporte-cota:${c.id}`,
      cotaId: c.id,
      refHash: c.emissaoTxHash ?? c.hashValidacao ?? undefined,
    });
    if (criado) a++;
  }
  return { realizacoes: r, aportes: a };
}
