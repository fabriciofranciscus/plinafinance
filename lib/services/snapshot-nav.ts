/**
 * Snapshot diário do NAV ancorado na rede (E3-1, SOW entregável 3).
 *
 * Fluxo (contrato: contratos/2026-11-11-e3-1-snapshot-nav.md):
 *   gates (NAV disponível + conciliação E3-4b) → JSON canônico RFC 8785 → SHA-256 → claim no banco
 *   (1 linha por dia UTC, com os bytes) → arquivo público no Blob → `ancorarSha256` a partir do distributor
 *   → grava txHash. O revisor confere `Memo.hash da tx == SHA-256 do arquivo publicado`.
 *
 * - Idempotente por dia: 2ª chamada devolve `reutilizada: true` sem rede e sem 2ª âncora.
 * - Retomável: queda depois do claim retoma com os MESMOS bytes (nunca recalcula: o hash ancorado tem de ser o
 *   do arquivo publicado). Lease de 5 min impede duas execuções na mesma linha.
 * - Fail-closed: qualquer gate que falhe não grava nada e não publica.
 * - Sem PII: o arquivo só tem ids de cota (cuid), chave pública do issuer e valores.
 */
import { createHash } from 'node:crypto';
import { Prisma, type SnapshotNav } from '@prisma/client';
import { db } from '../db';
import { publicarArquivoSnapshot, PublicacaoSnapshotError } from '../integrations/blob/nav-snapshot';
import { horizon } from '../stellar/account';
import { AncoraError, ancorarSha256 } from '../stellar/ancora';
import { STELLAR_NETWORK } from '../stellar/config';
import { ConciliacaoError, exigirConciliacao } from '../stellar/conciliacao';
import { extractSafeError } from '../stellar/log-error';
import type { SupplyOnChain } from '../stellar/supply';
import { canonicalizar } from './json-canonico';
import { NavIndisponivelError, lerSupplyDoNav } from './nav-supply';
import { navParaEmissao } from './pool';
import {
  NOTA_DENOMINADOR,
  NOTA_NAV_INICIAL,
  SNAPSHOT_TIPO,
  SNAPSHOT_VERSAO,
  f7,
  f8,
  montarNumerador,
  recalcularNav,
  type ArquivoSnapshotNav,
  type AtivoCirculadoNoArquivo,
} from './snapshot-nav-arquivo';

export const SNAPSHOT_LEASE_MS = 5 * 60_000;

export type SnapshotNavErrorCode =
  | 'NAV_INDISPONIVEL'
  | 'CONCILIACAO_DIVERGENTE'
  | 'CONCILIACAO_HISTORICO_EXCEDE_LIMITE'
  | 'LEITURA_INCONSISTENTE'
  | 'PUBLICACAO_FALHOU'
  | 'ANCORA_FALHOU'
  | 'CONTEUDO_ADULTERADO'
  | 'EM_ANDAMENTO';

const MENSAGENS: Record<SnapshotNavErrorCode, string> = {
  NAV_INDISPONIVEL: 'Snapshot do NAV não publicado: NAV indisponível.',
  CONCILIACAO_DIVERGENTE: 'Snapshot do NAV não publicado: o circulante não concilia com as trustlines.',
  CONCILIACAO_HISTORICO_EXCEDE_LIMITE: 'Snapshot do NAV não publicado: conciliação acima do limite de leitura.',
  LEITURA_INCONSISTENTE: 'Snapshot do NAV não publicado: as leituras mudaram durante a geração.',
  PUBLICACAO_FALHOU: 'Snapshot do NAV não publicado: o arquivo não pôde ser publicado.',
  ANCORA_FALHOU: 'Snapshot do NAV não ancorado na rede; repetir é seguro.',
  CONTEUDO_ADULTERADO: 'Snapshot do NAV: o conteúdo gravado não confere com o hash.',
  EM_ANDAMENTO: 'Snapshot do NAV: outra execução está publicando agora.',
};

export class SnapshotNavError extends Error {
  constructor(
    readonly code: SnapshotNavErrorCode,
    /** Detalhe seguro (código da causa), só para log/telemetria — nunca vai ao corpo do arquivo. */
    readonly causa?: string,
    options?: { cause?: unknown },
  ) {
    super(MENSAGENS[code], options);
    this.name = 'SnapshotNavError';
  }
}

export interface ResultadoSnapshotNav {
  publicado: true;
  reutilizada: boolean;
  data: string;
  sha256: string;
  txHash: string;
  url: string;
  navPorToken: string;
  /** Snapshots de dias anteriores que ficaram sem concluir e continuam pendentes após a tentativa de retomada. */
  pendentes: number;
}

const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const diaUtc = (d: Date) => d.toISOString().slice(0, 10);

// ── leitura do numerador ────────────────────────────────────────────────────────────────────────────────────

async function lerNumerador() {
  const [cotas, grupos] = await Promise.all([
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      select: {
        id: true, status: true, valorCarta: true, desagioAquisicao: true, tokensEmitidos: true,
        hashValidacao: true, emissaoTxHash: true,
      },
      orderBy: { id: 'asc' },
    }),
    db.movimentoFundo.groupBy({ by: ['tipo'], _sum: { deltaCaixa: true }, _count: { _all: true } }),
  ]);
  const porTipo: Record<string, Prisma.Decimal> = {};
  let movimentos = 0;
  for (const g of grupos) {
    porTipo[g.tipo] = g._sum.deltaCaixa ?? new Prisma.Decimal(0);
    movimentos += g._count._all;
  }
  return { cotas, caixa: { movimentos, porTipo } };
}

async function lerRaiz(): Promise<{ ledger: number; fechadoEm: string }> {
  const r = await horizon.root();
  return { ledger: r.history_latest_ledger, fechadoEm: r.history_latest_ledger_closed_at };
}

function ativoCirculado(
  s: SupplyOnChain,
  conc: { somaTrustlinesAutorizadas: Prisma.Decimal; contasAutorizadas: number },
): AtivoCirculadoNoArquivo {
  const saldoIssuer = new Prisma.Decimal(0);
  return {
    issuer: s.issuer,
    distributor: process.env.STELLAR_DISTRIBUTOR_PUBLIC ?? '',
    totalEmitido: f7(s.totalEmitido),
    saldoIssuer: f7(saldoIssuer),
    saldoDistributor: f7(s.tesouraria),
    circulante: f7(s.totalEmitido.minus(saldoIssuer).minus(s.tesouraria)),
    trustlinesAutorizadas: { contas: conc.contasAutorizadas, soma: f7(conc.somaTrustlinesAutorizadas) },
  };
}

/** Gates + leituras + montagem do arquivo. Lança `SnapshotNavError` sem gravar nada. */
async function gerarArquivo(agora: Date): Promise<{ arquivo: ArquivoSnapshotNav; navPorToken: Prisma.Decimal }> {
  const num1 = await lerNumerador();
  const horizonIni = await lerRaiz();

  let supply;
  try {
    supply = await lerSupplyDoNav({ fresh: true }); // NAV disponível: Horizon, trava D3, emissão e swap em voo
  } catch (err) {
    if (err instanceof NavIndisponivelError) throw new SnapshotNavError('NAV_INDISPONIVEL', err.motivo, { cause: err });
    throw err;
  }
  let conc;
  try {
    conc = await exigirConciliacao(); // E3-4b: Σ trustlines autorizadas = circulante, por asset code
  } catch (err) {
    if (err instanceof ConciliacaoError) throw new SnapshotNavError(err.code, undefined, { cause: err });
    throw err;
  }

  const horizonFim = await lerRaiz();
  const num2 = await lerNumerador();
  // Mainnet: valorCarta/deságio não vão ao arquivo público (política de preço; reidentificação do cedente).
  const opcoes = { incluirPrecoDaCarta: STELLAR_NETWORK !== 'PUBLIC' };
  const numerador = montarNumerador(num1.cotas, num1.caixa, opcoes);
  if (canonicalizar(numerador) !== canonicalizar(montarNumerador(num2.cotas, num2.caixa, opcoes))) {
    throw new SnapshotNavError('LEITURA_INCONSISTENTE', 'NUMERADOR_MUDOU');
  }
  // As duas leituras de circulante (NAV e conciliação) são independentes: têm de ser o mesmo número.
  if (
    !supply.senior.circulante.eq(conc.senior.circulante) ||
    !supply.subordinada.circulante.eq(conc.subordinada.circulante)
  ) {
    throw new SnapshotNavError('LEITURA_INCONSISTENTE', 'CIRCULANTE_MUDOU');
  }

  // Sem supply emitido o preço inicial (R$ 1,00) só vale com ativo zero; ativo > 0 sem token é inconsistência
  // (daria o pool inteiro ao 1º investidor): fail-closed (parecer da Consuelo, 11/11).
  if (supply.senior.totalEmitido.lte(0) && new Prisma.Decimal(numerador.total).gt(0)) {
    throw new SnapshotNavError('NAV_INDISPONIVEL', 'SUPPLY_ZERO_COM_ATIVO');
  }
  let navPorToken: Prisma.Decimal;
  try {
    navPorToken = navParaEmissao(
      num1.cotas.map((c) => ({ ...c, status: c.status })),
      [{ valorRealizado: numerador.caixaRealizado.total, spread: 0 }],
      supply.senior,
    );
  } catch {
    throw new SnapshotNavError('NAV_INDISPONIVEL', 'NAV_NAO_POSITIVO');
  }

  const classe = supply.senior.code;
  const arquivo: ArquivoSnapshotNav = {
    tipo: SNAPSHOT_TIPO,
    versao: SNAPSHOT_VERSAO,
    data: diaUtc(agora),
    geradoEm: agora.toISOString(),
    rede: STELLAR_NETWORK,
    horizon: {
      ledger: horizonIni.ledger,
      fechadoEm: horizonIni.fechadoEm,
      lidoEm: supply.senior.lidoEm.toISOString(),
      ledgerFinal: horizonFim.ledger,
    },
    numerador,
    circulante: {
      [supply.senior.code]: ativoCirculado(supply.senior, conc.senior),
      [supply.subordinada.code]: ativoCirculado(supply.subordinada, conc.subordinada),
    },
    conciliacao: {
      [conc.senior.code]: { confere: conc.senior.confere, diferenca: f7(conc.senior.diferenca) },
      [conc.subordinada.code]: { confere: conc.subordinada.confere, diferenca: f7(conc.subordinada.diferenca) },
    },
    nav: {
      classe,
      regra: 'NAV_DO_LEDGER',
      denominador: '',
      porToken: f8(navPorToken),
      porTokenSobreCirculante: null,
      notaDenominador: NOTA_DENOMINADOR,
    },
  };
  // Denominador, regra e NAV sobre circulante saem da MESMA conta que o revisor repete (não de uma 2ª fórmula).
  const r = recalcularNav(arquivo);
  if (!r.porToken.eq(navPorToken)) throw new SnapshotNavError('LEITURA_INCONSISTENTE', 'NAV_DIVERGE_DO_PRODUTO');
  arquivo.nav = {
    classe,
    regra: r.regra,
    denominador: f7(r.denominador),
    porToken: f8(r.porToken),
    porTokenSobreCirculante: r.porTokenSobreCirculante ? f8(r.porTokenSobreCirculante) : null,
    notaDenominador: NOTA_DENOMINADOR,
    ...(r.regra === 'NAV_INICIAL' ? { nota: NOTA_NAV_INICIAL } : {}),
  };
  return { arquivo, navPorToken };
}

// ── claim, lease e conclusão ────────────────────────────────────────────────────────────────────────────────

async function adquirirLease(id: string, agora: Date): Promise<boolean> {
  const r = await db.snapshotNav.updateMany({
    where: { id, status: 'PUBLICANDO', OR: [{ travaAte: null }, { travaAte: { lt: agora } }] },
    data: { travaAte: new Date(agora.getTime() + SNAPSHOT_LEASE_MS) },
  });
  return r.count === 1;
}

function resultado(row: SnapshotNav, reutilizada: boolean, pendentes: number): ResultadoSnapshotNav {
  return {
    publicado: true,
    reutilizada,
    data: row.data,
    sha256: row.sha256,
    txHash: row.txHash as string,
    url: row.url as string,
    navPorToken: row.navPorToken.toFixed(8),
    pendentes,
  };
}

/** Publica o arquivo gravado (mesmos bytes) e ancora o hash dele. Libera o lease se falhar. */
async function concluir(row: SnapshotNav): Promise<SnapshotNav> {
  try {
    const bytes = Buffer.from(row.conteudo, 'utf8');
    if (sha256Hex(bytes) !== row.sha256) throw new SnapshotNavError('CONTEUDO_ADULTERADO');
    const { url } = await publicarArquivoSnapshot({ data: row.data, bytes });
    const ancora = await ancorarSha256({ sha256Hex: row.sha256, contexto: 'SNAPSHOT_NAV' });
    return await db.snapshotNav.update({
      where: { id: row.id },
      data: { status: 'PUBLICADO', url, txHash: ancora.txHash, publicadoEm: new Date(), travaAte: null },
    });
  } catch (err) {
    await db.snapshotNav
      .updateMany({ where: { id: row.id, status: 'PUBLICANDO' }, data: { travaAte: null } })
      .catch(() => undefined);
    if (err instanceof SnapshotNavError) throw err;
    if (err instanceof PublicacaoSnapshotError) throw new SnapshotNavError('PUBLICACAO_FALHOU', err.motivo, { cause: err });
    if (err instanceof AncoraError) throw new SnapshotNavError('ANCORA_FALHOU', err.code, { cause: err });
    throw err;
  }
}

/** Retoma snapshots de dias anteriores que ficaram sem concluir. Devolve quantos continuam pendentes. */
async function retomarAnteriores(data: string, agora: Date): Promise<number> {
  const antigos = await db.snapshotNav.findMany({
    where: { status: 'PUBLICANDO', data: { lt: data } },
    orderBy: { data: 'asc' },
  });
  let pendentes = 0;
  for (const row of antigos) {
    try {
      if (!(await adquirirLease(row.id, agora))) {
        pendentes++;
        continue;
      }
      await concluir(row);
    } catch (err) {
      pendentes++;
      console.error('[snapshot-nav] retomada de dia anterior falhou', extractSafeError(err));
    }
  }
  return pendentes;
}

function ehUnique(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/**
 * Publica (ou reutiliza) o snapshot do dia UTC. Resposta 2xx só depois de gates, arquivo no ar, âncora
 * confirmada e txHash persistido.
 */
export async function publicarSnapshotNav(opts: { agora?: Date } = {}): Promise<ResultadoSnapshotNav> {
  const agora = opts.agora ?? new Date();
  const data = diaUtc(agora);

  // Dias anteriores sem concluir são retomados primeiro (e contados como pendência se continuarem abertos).
  const pendentesAntes = await retomarAnteriores(data, agora);
  const existente = await db.snapshotNav.findUnique({ where: { data } });
  if (existente?.status === 'PUBLICADO') return resultado(existente, true, pendentesAntes);

  let row = existente;
  if (row) {
    // Queda no meio do dia: retoma com os bytes gravados.
    if (!(await adquirirLease(row.id, agora))) throw new SnapshotNavError('EM_ANDAMENTO');
  } else {
    const { arquivo, navPorToken } = await gerarArquivo(agora);
    const conteudo = canonicalizar(arquivo);
    const bytes = Buffer.from(conteudo, 'utf8');
    try {
      row = await db.snapshotNav.create({
        data: {
          data,
          conteudo,
          sha256: sha256Hex(bytes),
          navPorToken,
          ledger: arquivo.horizon.ledger,
          travaAte: new Date(agora.getTime() + SNAPSHOT_LEASE_MS),
        },
      });
    } catch (err) {
      if (!ehUnique(err)) throw err;
      // Outra execução criou o claim entre a nossa leitura e a escrita: segue a dela.
      const outra = await db.snapshotNav.findUnique({ where: { data } });
      if (!outra) throw err;
      if (outra.status === 'PUBLICADO') return resultado(outra, true, pendentesAntes);
      throw new SnapshotNavError('EM_ANDAMENTO');
    }
  }
  const publicado = await concluir(row);
  return resultado(publicado, false, pendentesAntes);
}
