/**
 * Formato do arquivo do snapshot diário do NAV (E3-1) e a conta que o revisor repete.
 * Funções PURAS (sem banco, sem rede): o serviço monta o arquivo com elas e `scripts/snapshot-verificar.ts`
 * refaz o NAV com elas a partir do arquivo publicado. Contrato: contratos/2026-11-11-e3-1-snapshot-nav.md.
 *
 * Todo valor monetário/token é string decimal FIXA (BRL e tokens 7 casas, NAV 8): não há float no arquivo.
 */
import { Prisma } from '@prisma/client';
import { navDaCotaAsDecimal } from './pool';

export const SNAPSHOT_TIPO = 'plina.nav-snapshot';
export const SNAPSHOT_VERSAO = 1;

export interface AtivoCirculadoNoArquivo {
  issuer: string;
  /** Chave pública do distributor: de onde sai a âncora e cujo saldo entra na conta do circulante. */
  distributor: string;
  totalEmitido: string;
  /** Sempre 0: o Horizon `/assets` já exclui o issuer; explícito para o revisor. */
  saldoIssuer: string;
  saldoDistributor: string;
  /** totalEmitido − saldoIssuer − saldoDistributor (definição do SOW). */
  circulante: string;
  trustlinesAutorizadas: { contas: number; soma: string };
}

export interface ArquivoSnapshotNav {
  tipo: typeof SNAPSHOT_TIPO;
  versao: typeof SNAPSHOT_VERSAO;
  /** Dia UTC, YYYY-MM-DD. */
  data: string;
  geradoEm: string;
  rede: string;
  horizon: { ledger: number; fechadoEm: string; lidoEm: string; ledgerFinal: number };
  numerador: {
    /** valorMarcado = valorCarta × (1 − deságio): custo de aquisição, sem saldo devedor, correção nem provisão. */
    regraMarcacao: 'CUSTO_DE_AQUISICAO';
    /** De onde vem o numerador: não está no Horizon (o revisor refaz o denominador e a conciliação, não esta parte). */
    fonte: string;
    cotasAtivas: {
      quantidade: number;
      valorMarcado: string;
      itens: Array<{
        cotaId: string;
        status: string;
        valorMarcado: string;
        /** Laudo de validação (memo on-chain da validação); liga a cota à prova. */
        hashValidacao: string | null;
        /** Tx da emissão do token contra a cota. */
        emissaoTxHash: string | null;
        /** Só fora da mainnet (política de preço / reidentificação do cedente): parecer da Consuelo, 11/11. */
        valorCarta?: string;
        desagioAquisicao?: string;
      }>;
    };
    caixaRealizado: { total: string; movimentos: number; porTipo: Record<string, string> };
    total: string;
  };
  circulante: Record<string, AtivoCirculadoNoArquivo>;
  conciliacao: Record<string, { confere: boolean; diferenca: string }>;
  nav: {
    classe: string;
    regra: 'NAV_DO_LEDGER' | 'NAV_INICIAL';
    denominador: string;
    porToken: string;
    /** numerador ÷ circulante do SOW; só informação (null com circulante 0). */
    porTokenSobreCirculante: string | null;
    /** Por que o preço usa o supply emitido e não o circulante do SOW. */
    notaDenominador: string;
    /** Só com NAV_INICIAL: preço inicial de emissão, não um NAV medido. */
    nota?: string;
  };
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const f7 = (v: Prisma.Decimal.Value) => D(v).toFixed(7);
export const f8 = (v: Prisma.Decimal.Value) => D(v).toFixed(8);

export const NOTA_DENOMINADOR =
  'o preço usa o supply emitido (circulante + distributor): tokens do distributor são aporte da Plina, com direito ao ativo; porTokenSobreCirculante é só informação (circulante do SOW)';
export const FONTE_NUMERADOR =
  'declaração da Plina: cotas ativas e razão do fundo (banco); fora do Horizon; cada cota se liga à prova on-chain por hashValidacao e emissaoTxHash';
export const NOTA_NAV_INICIAL = 'sem tokens em circulação: preço inicial de emissão, não um NAV medido';

export interface CotaDoNumerador {
  id: string;
  status: string;
  valorCarta: Prisma.Decimal.Value;
  desagioAquisicao: Prisma.Decimal.Value;
  hashValidacao?: string | null;
  emissaoTxHash?: string | null;
}

export interface CaixaDoNumerador {
  movimentos: number;
  porTipo: Record<string, Prisma.Decimal.Value>;
}

/** Numerador do NAV (ativo): cotas ativas marcadas + caixa do razão. Mesma aritmética de `pool.ts`. */
export function montarNumerador(
  cotas: CotaDoNumerador[],
  caixa: CaixaDoNumerador,
  opts: { incluirPrecoDaCarta: boolean } = { incluirPrecoDaCarta: true },
): ArquivoSnapshotNav['numerador'] {
  const itens = [...cotas]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({
      cotaId: c.id,
      status: c.status,
      valorMarcado: navDaCotaAsDecimal(c).toFixed(2),
      hashValidacao: c.hashValidacao ?? null,
      emissaoTxHash: c.emissaoTxHash ?? null,
      ...(opts.incluirPrecoDaCarta
        ? { valorCarta: D(c.valorCarta).toFixed(2), desagioAquisicao: D(c.desagioAquisicao).toFixed(4) }
        : {}),
    }));
  const valorMarcado = itens.reduce((s, i) => s.plus(i.valorMarcado), D(0));
  const porTipo: Record<string, string> = {};
  let total = D(0);
  for (const tipo of Object.keys(caixa.porTipo).sort()) {
    porTipo[tipo] = f7(caixa.porTipo[tipo]);
    total = total.plus(caixa.porTipo[tipo]);
  }
  return {
    regraMarcacao: 'CUSTO_DE_AQUISICAO',
    fonte: FONTE_NUMERADOR,
    cotasAtivas: { quantidade: itens.length, valorMarcado: valorMarcado.toFixed(2), itens },
    caixaRealizado: { total: f7(total), movimentos: caixa.movimentos, porTipo },
    total: f7(valorMarcado.plus(total)),
  };
}

/**
 * A conta do revisor, só com o conteúdo do arquivo: soma das cotas e do caixa, circulante pela definição do SOW
 * e NAV/token. `porToken` segue a regra do produto (emissão/resgate): denominador = supply emitido (circulante +
 * tesouraria do distributor); sem supply emitido o token vale R$ 1,00. Não confia em nenhum total pré-somado.
 */
export function recalcularNav(arq: Pick<ArquivoSnapshotNav, 'numerador' | 'circulante' | 'nav'>): {
  numerador: Prisma.Decimal;
  denominador: Prisma.Decimal;
  regra: 'NAV_DO_LEDGER' | 'NAV_INICIAL';
  porToken: Prisma.Decimal;
  porTokenSobreCirculante: Prisma.Decimal | null;
  circulante: Prisma.Decimal;
} {
  const cotas = arq.numerador.cotasAtivas.itens.reduce((s, i) => s.plus(i.valorMarcado), D(0));
  const caixa = Object.values(arq.numerador.caixaRealizado.porTipo).reduce((s, v) => s.plus(v), D(0));
  const numerador = cotas.plus(caixa);
  const ativo = arq.circulante[arq.nav.classe];
  if (!ativo) throw new RangeError(`classe ${arq.nav.classe} ausente em circulante`);
  const circulante = D(ativo.totalEmitido).minus(ativo.saldoIssuer).minus(ativo.saldoDistributor);
  // Denominador do produto: circulante + tesouraria (saldo do distributor) = emitido fora do issuer.
  const denominador = circulante.plus(ativo.saldoDistributor);
  const regra = denominador.lte(0) ? 'NAV_INICIAL' : 'NAV_DO_LEDGER';
  const porToken =
    regra === 'NAV_INICIAL'
      ? D(1)
      : numerador.div(denominador).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
  const porTokenSobreCirculante = circulante.gt(0)
    ? numerador.div(circulante).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN)
    : null;
  return { numerador, denominador, regra, porToken, porTokenSobreCirculante, circulante };
}
