/**
 * Leitura do supply que sustenta o NAV — a única porta de entrada do NAV para o
 * ledger (M1-2 / M1-4). Três garantias:
 *
 * 1. Fail-closed. Se o Horizon falha, ou se a leitura é inconsistente, NÃO existe
 *    NAV: lança `NavIndisponivelError`. Nunca cai em NAV 1 nem no estado da app.
 * 2. Trava D3 (interina, decisão da Thais 09/11): enquanto houver PLINARFB
 *    circulando, o NAV não é publicado nem usado em cotação de resgate — o
 *    denominador só conhece a Sênior e valorizaria a Subordinada pelo preço dela.
 * 3. Emissão em voo (E1-4, parecer da Consuelo): enquanto houver `TentativaEmissao`
 *    PENDENTE ou CONFIRMADA sem `aplicadaEm` (tx possivelmente na chain, domínio ainda sem a cota), o
 *    supply do ledger já tem +q e o ativo no banco ainda não tem +V: o NAV cairia.
 *    Fail-closed: sem NAV até a incorporação terminar (ou a tentativa expirar/falhar).
 * 4. Supply com lastro no razão: o PLINARF emitido no ledger não pode passar do
 *    que o razão do fundo registra (Σ `MovimentoFundo.deltaTokens`). Token a
 *    mais no ledger não tem ativo por trás e diluiria o NAV sem que nada
 *    parecesse errado. Caso de origem: o seed rodado duas vezes em 16/11/2026.
 * 5. TTL curto + single-flight: a rota pública de summary não vira amplificador
 *    de leitura ao Horizon (N requests = 1 leitura por janela).
 *
 * O asset code vem de `fetchSupplyDasClasses` (`assetCodeForClasse`): fonte
 * única, igual para a tela e para o resgate.
 */

import {
  fetchSupplyDasClasses,
  type SupplyDasClasses,
  type SupplyOnChain,
} from '../stellar/supply';
import { extractSafeError } from '../stellar/log-error';
import { db } from '../db';
import { supplyEmitidoParaNavAsDecimal, supplySemLastro } from './pool';

/** Janela em que o supply lido é reaproveitado. */
export const NAV_SUPPLY_TTL_MS = 15_000;

/** Mensagem pública constante — a causa fica só no log, com requestId. */
export const NAV_INDISPONIVEL_MENSAGEM =
  'NAV indisponível: o ledger não pôde ser confirmado agora.';

export type NavIndisponivelMotivo =
  | 'LEDGER_LEITURA_FALHOU'
  | 'SUBORDINADA_CIRCULANDO'
  | 'EMISSAO_PENDENTE'
  | 'NAV_NAO_POSITIVO'
  | 'SWAP_EM_VOO'
  | 'SUPPLY_SEM_LASTRO';

/**
 * Motivo em linguagem de operador, para o painel da operação. Nunca vai para a
 * página pública nem para a API, que seguem com `NAV_INDISPONIVEL_MENSAGEM`.
 */
export const NAV_MOTIVO_OPERADOR: Record<NavIndisponivelMotivo, string> = {
  LEDGER_LEITURA_FALHOU: 'O ledger ou o banco não respondeu. Recarregue em instantes.',
  SUBORDINADA_CIRCULANDO: 'Há PLINARFB circulando (trava D3): o NAV só conhece a classe Sênior.',
  EMISSAO_PENDENTE: 'Há uma incorporação com emissão em andamento. O NAV volta quando ela terminar.',
  NAV_NAO_POSITIVO: 'O NAV calculado não é positivo.',
  SWAP_EM_VOO: 'Há uma compra ou um resgate reservado e ainda não escriturado.',
  SUPPLY_SEM_LASTRO:
    'O ledger tem mais PLINARF emitido do que o razão do fundo registra. Reconciliar antes de publicar; as quantidades estão no log "[nav-supply] supply sem lastro".',
};

export class NavIndisponivelError extends Error {
  readonly code = 'LEDGER_UNAVAILABLE' as const;
  constructor(
    readonly motivo: NavIndisponivelMotivo,
    options?: { cause?: unknown },
  ) {
    super(NAV_INDISPONIVEL_MENSAGEM, options);
    this.name = 'NavIndisponivelError';
  }
}

export interface SupplyDoNav {
  /** Supply da Sênior (PLINARF): o denominador do NAV/token. */
  senior: SupplyOnChain;
  subordinada: SupplyOnChain;
}

let cache: { value: SupplyDasClasses; expiraEm: number } | null = null;
let emVoo: Promise<SupplyDasClasses> | null = null;

/** Só para testes. */
export function resetNavSupplyCache(): void {
  cache = null;
  emVoo = null;
}

async function lerDoLedger(): Promise<SupplyDasClasses> {
  try {
    return await fetchSupplyDasClasses();
  } catch (err) {
    // Causa só no log; quem chama devolve mensagem constante.
    console.error('[nav-supply] leitura do ledger falhou', extractSafeError(err));
    throw new NavIndisponivelError('LEDGER_LEITURA_FALHOU', { cause: err });
  }
}

/** Trava D3: PLINARFB circulando → sem NAV. Vale também para valor em cache. */
function aplicarTravaD3(supplies: SupplyDasClasses): SupplyDoNav {
  if (supplies.subordinada.circulante.gt(0)) {
    throw new NavIndisponivelError('SUBORDINADA_CIRCULANDO');
  }
  return { senior: supplies.senior, subordinada: supplies.subordinada };
}

/**
 * Há emissão on-chain sem o domínio gravado? Consulta o banco a CADA chamada (não passa pelo
 * cache): a trava não pode ficar velha. Falha de leitura é fail-closed.
 */
async function exigirSemEmissaoEmVoo(): Promise<void> {
  let emVooRow: { memoHash: string } | null;
  try {
    emVooRow = await db.tentativaEmissao.findFirst({
      where: { status: { in: ['PENDENTE', 'CONFIRMADA'] }, aplicadaEm: null },
      select: { memoHash: true },
    });
  } catch (err) {
    console.error('[nav-supply] leitura das tentativas de emissão falhou', extractSafeError(err));
    throw new NavIndisponivelError('LEDGER_LEITURA_FALHOU', { cause: err });
  }
  if (emVooRow) throw new NavIndisponivelError('EMISSAO_PENDENTE');
}

/**
 * Supply das duas classes com a trava D3 aplicada.
 *
 * - padrão: reaproveita a leitura por `NAV_SUPPLY_TTL_MS` e junta leituras
 *   simultâneas numa só (rota pública).
 * - `fresh: true`: ignora o TTL e lê o ledger agora (cotação/execução de
 *   resgate, que move dinheiro). A leitura nova renova o cache.
 *
 * Falha de leitura nunca é cacheada: a próxima chamada tenta de novo.
 */
/**
 * Swap em voo (N1, Atlas/Consuelo O4): um quote de SWAP com a XDR reservada (`submitXdrHash`) e ainda
 * sem `consumedAt` pode já ter emitido o token na chain sem a escrituração no banco; o supply do ledger
 * tem +q e o caixa do fundo ainda não tem +V, e o NAV cairia (ex.: R$ 100 mil na chain sem escrituração
 * → NAV −9%). Fail-closed: sem NAV até a escrituração (ou a reserva ser liberada). Consulta o banco a
 * cada chamada (não passa pelo cache) e falha de leitura também fecha. Só quote de swap (`plinarfAmount`).
 */
async function exigirSemSwapEmVoo(): Promise<void> {
  let emVooRow: { id: string } | null;
  try {
    // Swap de subscrição reservado e não escriturado (supply com +q sem o caixa) OU resgate com queima reservado
    // e não escriturado (supply com −q sem a baixa do caixa: o NAV subiria): qualquer um fecha o NAV (E2-6).
    const [swap, resgate] = await Promise.all([
      db.quote.findFirst({
        where: { submitXdrHash: { not: null }, consumedAt: null, plinarfAmount: { not: null } },
        select: { id: true },
      }),
      db.resgateCotacao.findFirst({
        where: { submitXdrHash: { not: null }, consumedAt: null },
        select: { id: true },
      }),
    ]);
    emVooRow = swap ?? resgate;
  } catch (err) {
    console.error('[nav-supply] leitura dos swaps em voo falhou', extractSafeError(err));
    throw new NavIndisponivelError('LEDGER_LEITURA_FALHOU', { cause: err });
  }
  if (emVooRow) throw new NavIndisponivelError('SWAP_EM_VOO');
}

/**
 * Supply sem lastro: o ledger tem mais PLINARF emitido do que o razão do fundo registra. Roda DEPOIS dos
 * gates de emissão e swap em voo (que cobrem a janela legítima em que o ledger já tem +q e o razão ainda
 * não), e sobre o supply que vai ser devolvido, inclusive o do cache. O razão é lido a cada chamada.
 * Falha de leitura fecha, como nos outros gates.
 */
async function exigirSupplyComLastro(supplies: SupplyDoNav): Promise<SupplyDoNav> {
  let noRazao;
  try {
    const agg = await db.movimentoFundo.aggregate({ _sum: { deltaTokens: true } });
    noRazao = agg._sum.deltaTokens ?? 0;
  } catch (err) {
    console.error('[nav-supply] leitura do razão do fundo falhou', extractSafeError(err));
    throw new NavIndisponivelError('LEDGER_LEITURA_FALHOU', { cause: err });
  }
  const emitido = supplyEmitidoParaNavAsDecimal(supplies.senior);
  const { excedente, semLastro } = supplySemLastro(emitido, noRazao);
  if (semLastro) {
    // Só quantidades (públicas no ledger): o operador precisa delas para reconciliar.
    console.error('[nav-supply] supply sem lastro no razão do fundo', {
      emitidoNoLedger: emitido.toString(),
      noRazao: noRazao.toString(),
      excedente: excedente.toString(),
    });
    throw new NavIndisponivelError('SUPPLY_SEM_LASTRO');
  }
  return supplies;
}

export async function lerSupplyDoNav(opts: { fresh?: boolean } = {}): Promise<SupplyDoNav> {
  // Dois gates fail-closed (cada um consulta o banco a cada chamada, fora do cache): emissão de cota em voo
  // (E1-4: TentativaEmissao PENDENTE/CONFIRMADA sem aplicadaEm) e swap de subscrição em voo (N1: Quote
  // reservado e sem consumedAt). Qualquer um fecha o NAV. Depois da leitura, o supply ainda tem de ter
  // lastro no razão (`exigirSupplyComLastro`).
  await exigirSemEmissaoEmVoo();
  await exigirSemSwapEmVoo();
  if (!opts.fresh) {
    if (cache && Date.now() < cache.expiraEm) return exigirSupplyComLastro(aplicarTravaD3(cache.value));
    if (emVoo) return exigirSupplyComLastro(aplicarTravaD3(await emVoo));
  }

  const leitura = lerDoLedger().then((value) => {
    cache = { value, expiraEm: Date.now() + NAV_SUPPLY_TTL_MS };
    return value;
  });
  if (!opts.fresh) {
    emVoo = leitura;
    const limpar = () => {
      if (emVoo === leitura) emVoo = null;
    };
    leitura.then(limpar, limpar);
  }
  return exigirSupplyComLastro(aplicarTravaD3(await leitura));
}
