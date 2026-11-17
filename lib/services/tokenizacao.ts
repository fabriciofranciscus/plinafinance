/**
 * Tokenizacao service — orquestra incorporação de cotas e clawback.
 *
 * Key rules CLAUDE.md cumpridas aqui:
 *   - DB só atualiza APÓS sucesso on-chain (Stellar tx submit antes do Prisma create).
 *   - Audit log append-only via EventoAudit.
 *   - Idempotência: emissão usa UUID-like via DB para evitar duplicação caso
 *     o submit fique pendurado (POC aceita risco de retry duplo — Stellar
 *     submitTransaction é geralmente idempotente por hash do envelope).
 *   - Clawback exige motivo (enum força em compile-time) + fundamentoUrl
 *     ANTES de chamar executeClawback no issuer.
 *
 * Whitepaper §6.4 (PLINA-RF lastro), §6.5 (política clawback).
 */

import { createHash } from 'node:crypto';
import {
  AnuenciaStatus,
  CaminhoRealizacao,
  MotivoClawback,
  Prisma,
  StatusCota,
  TipoBem,
} from '@prisma/client';
import { db } from '../db';
import {
  buildIssueAssetTx,
  buscarEmissaoPorMemo,
  buscarTxPorHash,
  quemConsumiuSequence,
  txExpirouNaRede,
  executeClawback,
  submitEnvelope,
} from '../stellar/issuer';
import { issuerSigner } from '../stellar/signer';
import { navDaCotaAsDecimal } from './pool';
import { calcularPrecoDeEmissao } from './emissao';
import { registrarMovimentoFundo } from './razao-fundo';
import { getStellarPlinaPositionPublic } from '../env/ops';
import { logStellarError } from '../stellar/log-error';
import { causaSegura } from '../api/causa-segura';
import { STELLAR_NETWORK, assetCode } from '../stellar/config';
import { assetCodeForClasse, classeFromAssetCode } from '../stellar/classes';
import { decrementarHolding } from './holdings';
import { buildAuditPayload, registerOnChainHash } from '../stellar/audit';
import { RegistroIncorporacaoError, ancorarRegistroIncorporacao } from './registro-incorporacao';

export interface IncorporarCotaInput {
  tipoBem: TipoBem;
  administradora: string;
  valorCarta: string;
  desagioAquisicao: string;
  desagioRevenda?: string;
  localizacaoAprox?: string;
  prazoRestanteMeses?: number;
  caminhoPrevisto?: CaminhoRealizacao;
  notas?: string;
  operador: string;
  /// Quando a cota veio do funil vendedor, liga à Cessao que originou.
  cessaoId?: string;
  /// Hash do laudo (`registrarLaudo`/`COTA_VALIDADA`). OBRIGATÓRIO: sem laudo
  /// registrado a emissão é recusada (E1-4, Lei 11.795 art. 13). Tipado como
  /// opcional só para não quebrar chamadores antigos — a recusa é em runtime.
  hashValidacao?: string;
  /// Pix pago ao cedente (funil). Se vier, precisa bater com o custo de aquisição.
  pixValorBrl?: string;
  /// Hash do comprovante/tx do Pix; vai para o `MovimentoFundo` APORTE_COTA.
  pixHash?: string;
}

export interface IncorporarCotaResult {
  cotaId: string;
  txHash: string;
  tokensEmitidos: number;
}

export type IncorporacaoBloqueioCodigo =
  | 'LAUDO_AUSENTE'
  | 'LAUDO_JA_USADO'
  | 'ANUENCIA_AUSENTE'
  | 'ANUENCIA_PENDENTE_EM_MAINNET'
  | 'POSICAO_PLINA_AUSENTE'
  | 'CUSTO_INVALIDO'
  | 'PIX_DIVERGE_DO_CUSTO'
  | 'VALOR_DIVERGE_DA_TENTATIVA'
  | 'ANCORA_INCORPORACAO_FALHOU';

const BLOQUEIO_MENSAGEM: Record<IncorporacaoBloqueioCodigo, string> = {
  LAUDO_AUSENTE: 'Emissão recusada: laudo de validação legal não registrado (hashValidacao).',
  LAUDO_JA_USADO: 'Emissão recusada: este laudo já sustenta outra cota.',
  ANUENCIA_AUSENTE:
    'Emissão recusada: anuência da administradora não registrada (nem como declarada pendente).',
  ANUENCIA_PENDENTE_EM_MAINNET:
    'Emissão recusada: em mainnet a anuência precisa estar CONFIRMADA; "declarada pendente" só vale em testnet.',
  POSICAO_PLINA_AUSENTE:
    'Emissão recusada: conta de posição da Plina não configurada.',
  CUSTO_INVALIDO: 'Emissão recusada: custo de aquisição não positivo.',
  PIX_DIVERGE_DO_CUSTO: 'Emissão recusada: valor do Pix difere do custo de aquisição.',
  VALOR_DIVERGE_DA_TENTATIVA:
    'Emissão recusada: já existe uma emissão em andamento ou confirmada para esta incorporação com outro valor de aporte. Restaure o valor original; o operador decide.',
  ANCORA_INCORPORACAO_FALHOU:
    'Emissão recusada: o registro canônico da incorporação não foi ancorado. Nada foi emitido; tente de novo (alerta).',
};

export class IncorporacaoBloqueadaError extends Error {
  constructor(readonly code: IncorporacaoBloqueioCodigo) {
    super(BLOQUEIO_MENSAGEM[code]);
    this.name = 'IncorporacaoBloqueadaError';
  }
}

/**
 * Pré-condições de domínio da emissão (parecer da Consuelo, C2): laudo
 * registrado (com `hashValidacao`) + anuência (real, ou "declarada pendente"
 * em testnet). A prova é o `EventoAudit` — append-only, não um campo que o
 * chamador pudesse inventar.
 */
export async function verificarPreCondicoesDeEmissao(hashValidacao: string | undefined): Promise<{
  hashValidacao: string;
  validacaoTxHash: string | null;
  anuenciaStatus: AnuenciaStatus;
}> {
  if (!hashValidacao) throw new IncorporacaoBloqueadaError('LAUDO_AUSENTE');
  const laudo = await db.eventoAudit.findFirst({
    where: { acao: 'COTA_VALIDADA', payloadHash: hashValidacao },
    select: { stellarTxHash: true },
  });
  if (!laudo) throw new IncorporacaoBloqueadaError('LAUDO_AUSENTE');

  const anuencia = await db.eventoAudit.findFirst({
    where: {
      acao: 'ANUENCIA_REGISTRADA',
      payloadJson: { path: ['hashValidacao'], equals: hashValidacao },
    },
    orderBy: { criadoEm: 'desc' },
    select: { payloadJson: true },
  });
  const status = (anuencia?.payloadJson as { status?: string } | null)?.status;
  if (status !== 'CONFIRMADA' && status !== 'DECLARADA_PENDENTE') {
    throw new IncorporacaoBloqueadaError('ANUENCIA_AUSENTE');
  }
  if (status === 'DECLARADA_PENDENTE' && STELLAR_NETWORK === 'PUBLIC') {
    throw new IncorporacaoBloqueadaError('ANUENCIA_PENDENTE_EM_MAINNET');
  }

  return {
    hashValidacao,
    validacaoTxHash: laudo.stellarTxHash ?? null,
    anuenciaStatus: status as AnuenciaStatus,
  };
}

export type IncorporacaoEmissaoCodigo = 'EMISSAO_EM_ANDAMENTO' | 'EMISSAO_FALHOU';

/**
 * A emissão não está concluída: `EMISSAO_EM_ANDAMENTO` (erro ambíguo; a tx ainda
 * pode entrar até `maxTime` — NADA foi gravado no domínio e nenhuma tx nova será
 * criada antes disso) ou `EMISSAO_FALHOU` (definitiva, com os result codes).
 */
export class IncorporacaoEmissaoError extends Error {
  constructor(
    readonly code: IncorporacaoEmissaoCodigo,
    readonly detalhes: { maxTime?: Date; resultCodes?: unknown } = {},
  ) {
    super(
      code === 'EMISSAO_EM_ANDAMENTO'
        ? detalhes.maxTime && detalhes.maxTime.getTime() > Date.now()
          ? `Emissão em andamento; nada foi gravado. Tente de novo depois de ${detalhes.maxTime.toISOString()}.`
          : 'Emissão em andamento; nada foi gravado e nenhuma tx nova foi criada. Tente de novo em instantes.'
        : 'Emissão recusada pela rede; nada foi gravado. Uma nova tentativa já pode ser feita.',
    );
    this.name = 'IncorporacaoEmissaoError';
  }
}

interface EmissaoOnChain {
  txHash: string;
  quantidade: Prisma.Decimal;
  navAntes: Prisma.Decimal;
  recuperada: boolean;
  /** E1-p: âncora do registro feita NESTA chamada (tx nova), antes do build. */
  ancora?: AncoraDoRegistro;
  /** E1-p: `desde` para reencontrar a âncora na recuperação (criação da tentativa). */
  desdeAncora?: Date;
  /** Emissão anterior à tabela de tentativas (achada só pelo memo): não há registro anterior a ela. */
  legado?: boolean;
}

type AncoraDoRegistro = Awaited<ReturnType<typeof ancorarRegistroIncorporacao>>;

/** Item do histórico de uma `TentativaEmissao` (JSON): a tentativa que foi substituída ou encerrada. */
interface ItemHistoricoTentativa {
  txHash: string;
  envelopeXdr?: string;
  sequence?: string;
  maxTime: string;
  status: string;
  valorBrl: string;
  quantidade: string;
  navPorToken: string;
  substituidaEm: string;
}

type LinhaTentativa = NonNullable<Awaited<ReturnType<typeof db.tentativaEmissao.findUnique>>>;

/**
 * `tx_too_late` NÃO prova que a tx não entrou: no core o prazo é validado antes da sequence, então
 * reenviar uma tx que JÁ entrou, mas expirou, volta tx_too_late. Com o Horizon atrasado (404 por
 * hash) tratá-la como falha definitiva emitiria duas vezes.
 */
const ehTxTooLate = (resultCodes: unknown) =>
  (resultCodes as { transaction?: unknown } | null)?.transaction === 'tx_too_late';

/** Erro de operador da substituição (`EmissaoError` da Estela): a mesma sequence já foi consumida. */
const ehSequenciaConsumida = (err: unknown) =>
  (err as { code?: unknown } | null)?.code === 'EMISSAO_SEQUENCIA_CONSUMIDA';

/**
 * Garante UMA emissão on-chain para esta incorporação e devolve o que foi emitido.
 *
 * A `TentativaEmissao` (fora do domínio) é gravada com `db` — numa transação
 * própria, que commita antes do submit e sobrevive ao rollback da transação de
 * domínio. Em erro ambíguo o MESMO envelope (mesmo hash, mesma sequence) é
 * reenviado até o `maxTime`. Depois dele, a expiração vem do Horizon
 * (`txExpirouNaRede`), nunca do relógio local, e a substituição reaproveita a
 * MESMA sequence (`buildIssueAssetTx({ sequenceDe })` + `submitEnvelope({ substitui })`):
 * só uma das duas txs pode entrar, então nunca se emite duas vezes. Tx com sequence
 * NOVA só depois de prova positiva de que a sequence antiga não emitiu
 * (`quemConsumiuSequence`) ou de falha definitiva. Nunca reassina o envelope salvo.
 */
async function obterEmissaoOnChain(input: {
  memoHash: Buffer;
  code: string;
  posicaoPlina: string;
  valorAporte: Prisma.Decimal;
  /** E1-p: ancora o registro canônico com os números da tx NOVA, ANTES do build. Lança → nada é emitido. */
  ancorarAntes: (quantidade: Prisma.Decimal, nav: Prisma.Decimal) => Promise<AncoraDoRegistro>;
}): Promise<EmissaoOnChain> {
  const { memoHash, code, posicaoPlina, valorAporte, ancorarAntes } = input;
  const chave = memoHash.toString('hex');
  const tentativa = await db.tentativaEmissao.findUnique({ where: { memoHash: chave } });
  // Tentativa encerrada nesta chamada (vira item do histórico quando sai tx com sequence nova).
  let encerradaComo: 'FALHOU' | 'EXPIRADA' | undefined;
  let historicoAtual: ItemHistoricoTentativa[] = Array.isArray(tentativa?.historico)
    ? (tentativa.historico as unknown as ItemHistoricoTentativa[])
    : [];
  let anteriorParaHistorico: LinhaTentativa | null | undefined = tentativa;

  const itemDe = (t: LinhaTentativa, status: string): ItemHistoricoTentativa => ({
    txHash: t.txHash,
    envelopeXdr: t.envelopeXdr,
    sequence: t.sequence ?? undefined,
    maxTime: t.maxTime.toISOString(),
    status,
    valorBrl: new Prisma.Decimal(t.valorBrl).toString(),
    quantidade: new Prisma.Decimal(t.quantidade).toString(),
    navPorToken: new Prisma.Decimal(t.navPorToken).toString(),
    substituidaEm: new Date().toISOString(),
  });

  // O domínio grava V da chamada atual com a q já emitida: se V mudou enquanto a tx pode
  // estar (ou já está) na chain, o NAV subiria/cairia sem aporte correspondente. Recusa.
  const exigirMesmoValor = (t: { valorBrl: Prisma.Decimal.Value }) => {
    if (!new Prisma.Decimal(t.valorBrl).eq(valorAporte)) {
      throw new IncorporacaoBloqueadaError('VALOR_DIVERGE_DA_TENTATIVA');
    }
  };

  const emAndamento = (t: { maxTime: Date }) =>
    new IncorporacaoEmissaoError('EMISSAO_EM_ANDAMENTO', { maxTime: t.maxTime });

  /** `hash` pode ser o da tentativa ANTERIOR (a substituição devolve SUCCESS com o hash de quem emitiu). */
  const confirmada = async (
    t: { txHash: string; quantidade: Prisma.Decimal.Value; navPorToken: Prisma.Decimal.Value },
    hash?: string,
  ): Promise<EmissaoOnChain> => {
    const txHash = hash ?? t.txHash;
    await db.tentativaEmissao.update({
      where: { memoHash: chave },
      data: { status: 'CONFIRMADA', ...(txHash !== t.txHash ? { txHash } : {}) },
    });
    return {
      txHash,
      quantidade: new Prisma.Decimal(t.quantidade),
      navAntes: new Prisma.Decimal(t.navPorToken),
      recuperada: true,
      desdeAncora: tentativa?.criadaEm,
    };
  };

  const marcar = async (status: 'FALHOU' | 'EXPIRADA') => {
    await db.tentativaEmissao.update({ where: { memoHash: chave }, data: { status } });
    encerradaComo = status;
  };

  /** Envelopes desta emissão que usaram a MESMA sequence (as anteriores no histórico + a atual). */
  const xdrsDaSequence = (t: LinhaTentativa, hist: ItemHistoricoTentativa[]): string[] => {
    if (!t.sequence) return [t.envelopeXdr];
    return [
      ...hist.filter((h) => h.sequence === t.sequence && h.envelopeXdr).map((h) => h.envelopeXdr as string),
      t.envelopeXdr,
    ];
  };

  /**
   * EMISSAO_SEQUENCIA_CONSUMIDA: a sequence foi consumida e a substituição não entrou. Prova
   * POSITIVA de quem a consumiu decide (contrato 2026-11-10-substituicao-mesma-sequence):
   * a nossa e ok → confirma; a nossa e falhou ou outra tx do issuer → libera sequence nova;
   * indeterminado → mantém PENDENTE, nada reemitido.
   */
  const resolverConsumoDaSequence = async (
    t: LinhaTentativa,
    hist: ItemHistoricoTentativa[],
  ): Promise<EmissaoOnChain | 'LIBERADA'> => {
    let c: Awaited<ReturnType<typeof quemConsumiuSequence>>;
    try {
      // xdrs: os envelopes que temos; hashesConhecidos: o txHash de TODAS as tentativas (histórico
      // + a atual). A primitiva também reconhece a nossa pelo Memo.hash da emissão (Q1 do Argus).
      c = await quemConsumiuSequence(xdrsDaSequence(t, hist), {
        hashesConhecidos: [...hist.map((h) => h.txHash), t.txHash],
      });
    } catch (err) {
      logStellarError('[incorporarCota] consumo da sequence indeterminado', err);
      throw emAndamento(t);
    }
    if (c.status === 'ANTIGA_ENTROU' && c.successful) {
      exigirMesmoValor(t);
      return confirmada(t, c.hash);
    }
    if (c.status === 'ANTIGA_ENTROU') {
      await marcar('FALHOU'); // prova on-chain de que a sequence não emitiu
      return 'LIBERADA';
    }
    if (c.status === 'OUTRA_TX') {
      await marcar('EXPIRADA'); // outra tx do issuer consumiu a sequence: a nossa não emitiu
      return 'LIBERADA';
    }
    throw emAndamento(t); // INDETERMINADO: consultar depois
  };

  /** Reenvia/envia o envelope SALVO (nunca reassina) e resolve o desfecho. */
  const enviarEnvelopeSalvo = async (
    t: LinhaTentativa,
    hist: ItemHistoricoTentativa[],
    substitui?: string,
  ): Promise<EmissaoOnChain | 'LIBERADA'> => {
    const anterior =
      substitui ??
      (t.sequence
        ? [...hist].reverse().find((h) => h.sequence === t.sequence && h.envelopeXdr)?.envelopeXdr
        : undefined);
    let r: Awaited<ReturnType<typeof submitEnvelope>>;
    try {
      r = await submitEnvelope(t.envelopeXdr, anterior ? { substitui: anterior } : undefined);
    } catch (err) {
      if (ehSequenciaConsumida(err)) return resolverConsumoDaSequence(t, hist);
      throw err; // erro que não é EmissaoError: a tentativa continua PENDENTE
    }
    if (r.status === 'SUCCESS') return confirmada(t, r.hash);
    if (r.status === 'FAILED') {
      // `tx_bad_seq` & cia.: pode já ter entrado — confere pelo hash antes de afirmar falha.
      const depois = await buscarTxPorHash(t.txHash);
      if (depois.found && depois.successful) return confirmada(t);
      // FAILED de um envelope JÁ salvo (reenvio ou substituição) é AMBÍGUO, nunca FALHOU: o core
      // checa prazo e taxa antes da sequence, então uma tx que já entrou pode voltar tx_too_late
      // (ou outro código) ao ser reenviada, e um Horizon atrasado não a mostra por hash. Mantém
      // PENDENTE; a próxima chamada decide por txExpirouNaRede, pela substituição com a MESMA
      // sequence e, se a sequence for consumida, por quemConsumiuSequence. FALHOU só vem do
      // hash achado com falha, de ANTIGA_ENTROU com falha ou do 1º submit de tx nova.
      throw emAndamento(t);
    }
    throw emAndamento(t);
  };

  if (tentativa && (tentativa.status === 'PENDENTE' || tentativa.status === 'CONFIRMADA')) {
    // Caminho principal: a tx desta tentativa já está na chain?
    const achada = await buscarTxPorHash(tentativa.txHash);
    if (achada.found) {
      if (achada.successful) {
        exigirMesmoValor(tentativa);
        return confirmada(tentativa);
      }
      // Entrou e falhou on-chain: a sequence foi consumida e nada foi emitido; libera tx nova.
      await marcar('FALHOU');
    } else if (Date.now() < tentativa.maxTime.getTime()) {
      // Ainda pode entrar: reenvia o MESMO envelope; nunca cria tx nova agora.
      exigirMesmoValor(tentativa); // antes de reenviar: reenviar já poria q de outro V na chain
      const r = await enviarEnvelopeSalvo(tentativa, historicoAtual);
      if (r !== 'LIBERADA') return r;
    } else {
      // Passou do maxTime pelo relógio local. O relógio só diz que vale PERGUNTAR à rede; quem
      // decide a expiração é o Horizon (contrato txExpirouNaRede). Sem reassinar.
      let veredito: Awaited<ReturnType<typeof txExpirouNaRede>>;
      try {
        veredito = await txExpirouNaRede(tentativa.envelopeXdr);
      } catch (err) {
        // Indeterminado (Horizon fora…): NÃO reemite; mantém a tentativa PENDENTE.
        logStellarError('[incorporarCota] expiração indeterminada', err);
        throw emAndamento(tentativa);
      }
      if (veredito.status === 'ENTROU') {
        if (veredito.successful) {
          exigirMesmoValor(tentativa);
          return confirmada(tentativa);
        }
        await marcar('FALHOU'); // entrou e falhou: nada emitido
      } else if (veredito.status === 'EM_ABERTO') {
        throw emAndamento(tentativa); // a rede ainda não fechou ledger depois do maxTime
      } else {
        // EXPIROU: substitui com a MESMA sequence, mesmo memo, destino, valor e asset. O valor
        // é o da tentativa antiga (a sequence é a trava): se V mudou, recusa (operador decide).
        exigirMesmoValor(tentativa);
        let sub: Awaited<ReturnType<typeof buildIssueAssetTx>>;
        try {
          sub = await buildIssueAssetTx(
            issuerSigner(),
            posicaoPlina,
            new Prisma.Decimal(tentativa.quantidade).toFixed(7),
            code,
            { memoHash, sequenceDe: tentativa.envelopeXdr },
          );
        } catch (err) {
          // ISSUE_SUBSTITUICAO_INVALIDA (ENTROU/EM_ABERTO na reconferência) ou Horizon fora:
          // não substitui, não reemite, mantém a tentativa.
          logStellarError('[incorporarCota] substituição recusada', err);
          throw emAndamento(tentativa);
        }
        const histNovo = [...historicoAtual, itemDe(tentativa, 'EXPIRADA')];
        const dadosSub = {
          historico: histNovo as unknown as Prisma.InputJsonValue,
          txHash: sub.hash,
          envelopeXdr: sub.xdr,
          maxTime: new Date(sub.maxTime * 1000),
          sequence: sub.sequence,
          status: 'PENDENTE' as const,
        };
        // Commita a substituição (com o hash anterior no histórico) ANTES de submeter.
        const linhaSub = await db.tentativaEmissao.update({ where: { memoHash: chave }, data: dadosSub });
        const r = await enviarEnvelopeSalvo(linhaSub, histNovo, tentativa.envelopeXdr);
        if (r !== 'LIBERADA') return r;
        historicoAtual = histNovo;
        anteriorParaHistorico = linhaSub;
      }
    }
  } else if (!tentativa) {
    // Rede de segurança: emissões anteriores a esta tabela (achadas só pelo memo).
    const porMemo = await buscarEmissaoPorMemo({ code, destination: posicaoPlina, memoHash });
    if (porMemo) {
      const quantidade = new Prisma.Decimal(porMemo.amount);
      if (!quantidade.gt(0)) throw new IncorporacaoBloqueadaError('CUSTO_INVALIDO');
      return {
        txHash: porMemo.txHash,
        quantidade,
        // O supply do ledger já inclui esta emissão: NAV "antes" reconstruído de V ÷ q.
        navAntes: valorAporte.div(quantidade).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN),
        recuperada: true,
        legado: true,
      };
    }
  }

  // Tx com sequence NOVA (1ª tentativa, ou a anterior comprovadamente não emitiu): NAV antes do
  // aporte (supply zero → 1,00); lança se o ledger não responde ou se PLINARFB circula (D3).
  // Constrói, COMMITA a tentativa e só então envia.
  const preco = await calcularPrecoDeEmissao({ valorBrl: valorAporte });
  // E1-p: o registro canônico (com ESTES números) é ancorado ANTES do build/submit. Falhou → nada emitido.
  const ancora = await ancorarAntes(preco.plinarfAmount, preco.navPorTokenNaCotacao);
  const built = await buildIssueAssetTx(
    issuerSigner(),
    posicaoPlina,
    preco.plinarfAmount.toFixed(7),
    code,
    { memoHash },
  );
  // Trilha: a tentativa anterior (FALHOU/EXPIRADA) vai para o histórico em vez de ser apagada.
  const historico: ItemHistoricoTentativa[] = [
    ...historicoAtual,
    ...(anteriorParaHistorico
      ? [itemDe(anteriorParaHistorico, encerradaComo ?? anteriorParaHistorico.status)]
      : []),
  ];
  const dados = {
    historico: historico as unknown as Prisma.InputJsonValue,
    txHash: built.hash,
    envelopeXdr: built.xdr,
    maxTime: new Date(built.maxTime * 1000),
    sequence: built.sequence,
    status: 'PENDENTE' as const,
    valorBrl: valorAporte,
    quantidade: preco.plinarfAmount,
    navPorToken: preco.navPorTokenNaCotacao,
  };
  await db.tentativaEmissao.upsert({
    where: { memoHash: chave },
    create: { memoHash: chave, ...dados },
    update: dados,
  });

  const r = await submitEnvelope(built.xdr);
  if (r.status === 'SUCCESS') {
    await db.tentativaEmissao.update({ where: { memoHash: chave }, data: { status: 'CONFIRMADA' } });
    return { txHash: r.hash, quantidade: preco.plinarfAmount, navAntes: preco.navPorTokenNaCotacao, recuperada: false, ancora };
  }
  if (r.status === 'FAILED' && ehTxTooLate(r.resultCodes)) {
    throw emAndamento({ maxTime: dados.maxTime }); // não prova que não entrou: fica PENDENTE
  }
  if (r.status === 'FAILED') {
    await db.tentativaEmissao.update({ where: { memoHash: chave }, data: { status: 'FALHOU' } });
    logStellarError('[incorporarCota] emissão recusada', new Error('FAILED'));
    throw new IncorporacaoEmissaoError('EMISSAO_FALHOU', { resultCodes: r.resultCodes });
  }
  // AMBIGUOUS: fica PENDENTE; a próxima chamada reenvia o mesmo envelope.
  throw emAndamento({ maxTime: dados.maxTime });
}

/** Memo.hash determinístico da emissão: um por cessão (ou, sem cessão, por laudo). */
export function memoHashDaIncorporacao(chave: string): Buffer {
  return createHash('sha256').update(`plina:incorporacao:${chave}`).digest();
}

/** Id determinístico da Cota: a PK vira a unicidade da incorporação (cessão/laudo). */
function cotaIdDaIncorporacao(memoHash: Buffer): string {
  return `inc_${memoHash.toString('hex').slice(0, 32)}`;
}

/**
 * Incorpora cota ao pool como APORTE da Plina ao NAV (ADR 2026-11-09, opção B):
 * `q = quantidadeEmitida(V, NAV antes)`, com V = custo de aquisição (= Pix ao
 * cedente). O token nasce na posição da Plina e a cota entra no ativo por V —
 * o NAV por token não muda.
 *
 * "DB depois da chain" e idempotência (contrato E1-4, 2026-11-10):
 *  1. pré-condições (laudo + anuência, conta de posição, custo/Pix) — só leitura;
 *  2. numa `$transaction`, lock de concorrência SEM linha de domínio
 *     (`pg_advisory_xact_lock` pela chave da incorporação);
 *  3. a cota já existe? (mesmo id determinístico) → devolve o resultado, sem
 *     reemitir; laudo usado por outra cota → recusa;
 *  4. `obterEmissaoOnChain`: `TentativaEmissao` (fora do domínio, commitada ANTES
 *     do submit) + busca por hash. Achou → reaproveita; ainda dentro do `maxTime`
 *     → reenvia o MESMO envelope e, se continuar ambíguo, `EMISSAO_EM_ANDAMENTO`
 *     (nada gravado, sem tx nova); expirada → pode construir tx nova;
 *  5. senão preço ao NAV (fail-closed, D3), constrói, grava a tentativa e envia;
 *  6. só depois do sucesso on-chain, na mesma transação: `Cota`, `EventoAudit`
 *     e `MovimentoFundo` APORTE_COTA. Falha em qualquer ponto desfaz a
 *     transação: nenhuma linha de domínio existe sem a tx on-chain.
 */
export async function incorporarCota(
  input: IncorporarCotaInput,
): Promise<IncorporarCotaResult> {
  const inicio = new Date(); // E1-p: `desde` da âncora do registro numa tx nova
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('STELLAR_ISSUER_SECRET obrigatório.');
  }
  // Conta de posição da Plina pelo getter de `lib/env` (fail-closed, mensagem
  // fixa): ausente ou inválida → emissão recusada, sem vazar nome de env.
  let posicaoPlina: string;
  try {
    posicaoPlina = getStellarPlinaPositionPublic();
  } catch {
    throw new IncorporacaoBloqueadaError('POSICAO_PLINA_AUSENTE');
  }

  const pre = await verificarPreCondicoesDeEmissao(input.hashValidacao);

  // V = custo de aquisição: o mesmo número que entra no ativo (navDaCota).
  const valorAporte = navDaCotaAsDecimal({
    valorCarta: input.valorCarta,
    desagioAquisicao: input.desagioAquisicao,
  });
  if (!valorAporte.gt(0)) throw new IncorporacaoBloqueadaError('CUSTO_INVALIDO');
  if (
    input.pixValorBrl !== undefined &&
    new Prisma.Decimal(input.pixValorBrl).minus(valorAporte).abs().gt('0.01')
  ) {
    throw new IncorporacaoBloqueadaError('PIX_DIVERGE_DO_CUSTO');
  }

  const code = assetCodeForClasse('SENIOR');
  const chaveIncorporacao = input.cessaoId ?? pre.hashValidacao;
  const memoHash = memoHashDaIncorporacao(chaveIncorporacao);
  const cotaId = cotaIdDaIncorporacao(memoHash);

  return db.$transaction(
    async (tx) => {
      // 2) Lock de concorrência: não grava nada, só serializa a mesma incorporação.
      // $executeRaw, não $queryRaw: a função devolve `void` e o Prisma não desserializa essa coluna (P2010).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plina:incorporacao:${chaveIncorporacao}`}))`;

      // 3) Já incorporada (reexecução ou chamada concorrente que perdeu o lock).
      const existente = await tx.cota.findUnique({
        where: { id: cotaId },
        select: { id: true, emissaoTxHash: true, tokensEmitidos: true },
      });
      if (existente) {
        return {
          cotaId: existente.id,
          txHash: existente.emissaoTxHash ?? '',
          tokensEmitidos: new Prisma.Decimal(existente.tokensEmitidos).toNumber(),
        };
      }
      const laudoUsado = await tx.cota.findFirst({
        where: { hashValidacao: pre.hashValidacao },
        select: { id: true },
      });
      if (laudoUsado) throw new IncorporacaoBloqueadaError('LAUDO_JA_USADO');

      // 4–5) Emissão on-chain idempotente, com reenvio do MESMO envelope no erro
      // ambíguo (contrato 2026-11-10-reemissao-erro-ambiguo). Qualquer falha ou
      // "em andamento" sai daqui ANTES de qualquer escrita de domínio.
      // E1-p: registro canônico da incorporação, ancorado pelo distributor ANTES da emissão.
      const ancorarRegistro = async (quantidade: Prisma.Decimal, nav: Prisma.Decimal, desde: Date) => {
        try {
          return await ancorarRegistroIncorporacao({
            cotaId,
            cessaoId: input.cessaoId ?? null,
            hashLaudo: pre.hashValidacao,
            valorIncorporadoBrl: valorAporte,
            tokensEmitir: quantidade,
            navPorTokenUsado: nav,
            issuer: issuerPublico(),
            asset: code,
            desde,
          });
        } catch (err) {
          if (err instanceof RegistroIncorporacaoError) {
            logStellarError('[incorporarCota] âncora do registro da incorporação falhou', err);
            // Ambígua (I1 do Argus): não espera dentro da transação; nada emitido, chamar de novo depois.
            if (err.ambigua) throw new IncorporacaoEmissaoError('EMISSAO_EM_ANDAMENTO');
            throw new IncorporacaoBloqueadaError('ANCORA_INCORPORACAO_FALHOU');
          }
          throw err;
        }
      };
      const emissao = await obterEmissaoOnChain({
        memoHash,
        code,
        posicaoPlina,
        valorAporte,
        ancorarAntes: (q, nav) => ancorarRegistro(q, nav, inicio),
      });
      const txHash = emissao.txHash;
      const quantidade = emissao.quantidade;
      const navAntes = emissao.navAntes;
      const recuperada = emissao.recuperada;
      const quantityStr = quantidade.toFixed(7);
      // Recuperação: a âncora foi feita antes da 1ª tentativa; reencontra pelo hash (mesmos números).
      const ancora = emissao.legado
        ? null
        : emissao.ancora ?? (await ancorarRegistro(quantidade, navAntes, emissao.desdeAncora ?? inicio));

      // 6) DB depois da chain, na mesma transação.
      await tx.cota.create({
        data: {
          id: cotaId,
          tipoBem: input.tipoBem,
          administradora: input.administradora,
          valorCarta: input.valorCarta,
          desagioAquisicao: input.desagioAquisicao,
          desagioRevenda: input.desagioRevenda ?? null,
          localizacaoAprox: input.localizacaoAprox ?? null,
          prazoRestanteMeses: input.prazoRestanteMeses ?? null,
          caminhoPrevisto: input.caminhoPrevisto ?? 'A_REVENDA',
          status: StatusCota.DISPONIVEL,
          tokensEmitidos: quantityStr,
          emissaoTxHash: txHash,
          hashValidacao: pre.hashValidacao,
          validacaoTxHash: pre.validacaoTxHash,
          anuenciaStatus: pre.anuenciaStatus,
          notas: input.notas ?? null,
          cessaoId: input.cessaoId ?? null,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'COTA_INCORPORADA',
          operador: input.operador,
          cotaId,
          stellarTxHash: txHash,
          // E1-p: o hash do evento é o memo da âncora do registro canônico (bytesCanonicos(registroCanonico)).
          ...(ancora ? { payloadHash: ancora.sha256Hex } : {}),
          payloadJson: {
            ...(ancora ? { registroCanonico: { ...ancora.registro }, ancoraTxHash: ancora.ancoraTxHash } : {}),
            quantity: quantityStr,
            valorCarta: input.valorCarta,
            desagioAquisicao: input.desagioAquisicao,
            valorAporteBrl: valorAporte.toFixed(2),
            navPorTokenAntes: navAntes.toFixed(8),
            hashValidacao: pre.hashValidacao,
            anuenciaStatus: pre.anuenciaStatus,
            recuperadaPorMemo: recuperada,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'TOKEN_EMITIDO',
          operador: input.operador,
          cotaId,
          stellarTxHash: txHash,
          payloadJson: {
            quantity: quantityStr,
            destination: posicaoPlina,
            asset: code,
          } as Prisma.InputJsonValue,
        },
      });
      // A Plina aporta a cota (nunca AQUISICAO: o fundo não pagou): ativo +V,
      // caixa 0, tokens +q. O Pix ao cedente não entra no caixa do fundo.
      const mov = await registrarMovimentoFundo(tx, {
        tipo: 'APORTE_COTA',
        valorBrl: valorAporte,
        tokens: quantityStr,
        chave: `aporte-cota:${cotaId}`,
        cotaId,
        navPorToken: navAntes,
        txHash,
        refHash: input.pixHash,
        hashValidacao: pre.hashValidacao,
      });
      if (!mov.criado) throw new Error('Aporte já registrado para esta incorporação.');

      // A tentativa só deixa de travar o NAV quando o domínio está gravado: o mesmo commit
      // que cria a Cota preenche `aplicadaEm` (sem tentativa, p.ex. achada só pelo memo, não faz nada).
      await tx.tentativaEmissao.updateMany({
        where: { memoHash: memoHash.toString('hex'), aplicadaEm: null },
        data: { aplicadaEm: new Date() },
      });

      return { cotaId, txHash, tokensEmitidos: quantidade.toNumber() };
    },
    // O trabalho dentro da transação é limitado (leituras + no máx. um envio e um reenvio da emissão, e um envio
    // da âncora do registro): NÃO há espera de 120 s aqui — o erro ambíguo da emissão E o da âncora (semEspera, I1 do
    // Argus) saem como EMISSAO_EM_ANDAMENTO e o reenvio é de uma nova chamada. Timeout mantido (não aumentado).
    { timeout: 120_000, maxWait: 15_000 },
  );
}

export interface ExecutarClawbackInput {
  investidorId: string;
  amount: string;
  motivo: MotivoClawback;
  fundamentoUrl: string;
  operador: string;
  /**
   * Chave de IDEMPOTÊNCIA do pedido (U1-11; Atlas/Argus): o admin gera um id por pedido; o mesmo `pedidoId` nunca executa duas
   * vezes. 16 a 64 caracteres de [A-Za-z0-9_-].
   */
  pedidoId: string;
  /**
   * Carteira (publicKey) que o operador VIU na revisão. Se vier e divergir da carteira lida do investidor no envio, o pedido é
   * recusado (`CARTEIRA_DIVERGENTE`) ANTES de gravar a tentativa e de qualquer envio. Ausente = comportamento anterior (a tela atual
   * não tem revisão da carteira); o PR 3 do U1-11 deve enviar sempre, e torná-la obrigatória é recusar aqui quando faltar.
   */
  carteiraRevisada?: string;
}

export interface ExecutarClawbackResult {
  /** Tx Stellar da operação clawback (Operation.clawback). */
  txHash: string;
  /** Tx Stellar do Memo.hash do fundamento (whitepaper §3.2). */
  fundamentoTxHash: string;
  /** SHA-256 do payload `{motivo, fundamentoUrl, ...}` gravado on-chain. */
  payloadHash: string;
  /** `true` quando o pedido já tinha sido executado (ou concluído de uma retomada): nenhuma nova execução on-chain. */
  idempotente?: boolean;
}

export type ClawbackErrorCode =
  | 'PEDIDO_INVALIDO'
  | 'FUNDAMENTO_INVALIDO'
  | 'VALOR_INVALIDO'
  | 'EMISSOR_NAO_CONFIGURADO'
  | 'INVESTIDOR_NAO_ENCONTRADO'
  | 'CARTEIRA_DIVERGENTE'
  | 'PEDIDO_EM_ANDAMENTO'
  | 'PEDIDO_FALHOU'
  | 'EXECUCAO_FALHOU'
  | 'EXECUCAO_INCERTA'
  | 'REGISTRO_PENDENTE';

/** Mensagens FIXAS (sem nome de variável, id, valor nem texto de terceiros): é o que o operador vê na tela. */
const MENSAGENS_CLAWBACK: Record<ClawbackErrorCode, string> = {
  PEDIDO_INVALIDO: 'Pedido de clawback inválido ou já usado com outros dados. Recarregue a tela e envie de novo.',
  FUNDAMENTO_INVALIDO: 'Informe a URL do fundamento (documento público, http ou https).',
  VALOR_INVALIDO: 'Informe uma quantidade maior que zero, só com dígitos e ponto decimal (até 12 inteiros e 7 casas).',
  EMISSOR_NAO_CONFIGURADO: 'A execução do clawback não está configurada neste ambiente.',
  INVESTIDOR_NAO_ENCONTRADO: 'Investidor não encontrado.',
  CARTEIRA_DIVERGENTE: 'A carteira do investidor não é a que você revisou. Nada foi executado nem registrado. Recarregue a tela, confira a carteira atual e envie de novo.',
  PEDIDO_EM_ANDAMENTO: 'Este pedido já foi enviado e está em andamento ou foi interrompido. Nada foi executado de novo. O clawback pode ter entrado na rede: NÃO crie outro pedido antes de conferir o saldo on-chain e o histórico.',
  PEDIDO_FALHOU: 'Este pedido já falhou antes e não será repetido. Confira o saldo e o histórico; se precisar, crie um novo pedido.',
  EXECUCAO_FALHOU: 'A rede recusou o clawback e ele não foi executado. Confira o saldo e o histórico; se precisar, crie um novo pedido.',
  EXECUCAO_INCERTA: 'O resultado do clawback é incerto: ele pode ter entrado na rede. NÃO crie outro pedido; confira o saldo on-chain e o histórico.',
  REGISTRO_PENDENTE: 'O clawback JÁ foi executado na rede, mas o registro não foi concluído. NÃO crie outro pedido: reenvie este mesmo para concluir o registro.',
};

export class ClawbackError extends Error {
  /** Só em REGISTRO_PENDENTE: o hash do clawback que já está na rede. */
  readonly txHash?: string;
  constructor(readonly code: ClawbackErrorCode, txHash?: string) {
    super(MENSAGENS_CLAWBACK[code]);
    this.name = 'ClawbackError';
    this.txHash = txHash;
  }
}

type PayloadClawback = {
  pedidoId?: string;
  amount?: string;
  targetPubkey?: string;
  status?: 'attempting' | 'onchain' | 'executed' | 'failed' | 'incerto';
  clawbackTxHash?: string;
  fundamentoTxHash?: string;
  /** ISO: quem está concluindo o registro (memo do fundamento + saldo) tem esse prazo; os outros reenvios esperam (U1-11, duplo envio). */
  concluindoDesde?: string;
  causa?: unknown;
};

/** Prazo de quem conclui o registro: o memo do fundamento tem timeout de rede bem menor. Depois dele, outro reenvio pode assumir (queda no meio). */
export const PRAZO_CONCLUSAO_CLAWBACK_MS = 2 * 60_000;

/**
 * Executa clawback. Whitepaper §6.5: 4 hipóteses exclusivas (enum força).
 * Audit log GRAVADO ANTES da execução on-chain — assim mesmo se Stellar falhar, fica registro da tentativa pra auditoria.
 *
 * IDEMPOTENTE por `pedidoId` (U1-11): o claim do pedido é uma transação curta sob `pg_advisory_xact_lock` que procura o evento do
 * pedido e, se não há, grava a tentativa (`attempting`). Só quem grava a tentativa executa. Estados do evento:
 *   attempting → onchain (clawback na rede, hash guardado) → executed (memo + saldo + holding, numa transação).
 * O mesmo pedido: `executed` devolve o resultado do 1º (sem nova execução); `onchain` RETOMA o registro (sem reexecutar o clawback
 * nem decrementar duas vezes); `attempting` e `failed` recusam (fail-closed): uma tentativa ambígua pode ter entrado na rede, e
 * repetir seria clawback em dobro.
 */
export async function executarClawback(
  input: ExecutarClawbackInput,
): Promise<ExecutarClawbackResult> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.pedidoId ?? '')) throw new ClawbackError('PEDIDO_INVALIDO');
  if (!input.fundamentoUrl || !/^https?:\/\//.test(input.fundamentoUrl)) throw new ClawbackError('FUNDAMENTO_INVALIDO');
  // Formato ANTES de gravar a tentativa (mesmo regex do liquidar/build): decimal puro, até 12 inteiros e 7 casas (precisão do ativo
  // Stellar). Sem isso o SDK recusava >7 casas/enorme só depois da tentativa gravada (pedido preso em `incerto` sem nada enviado) e
  // aceitava notação científica ("1e3" ficava cru na auditoria e a rede recebia 1000). A quantidade segue ao anchor como veio.
  if (typeof input.amount !== 'string' || !/^\d{1,12}(\.\d{1,7})?$/.test(input.amount)) throw new ClawbackError('VALOR_INVALIDO');
  const valor = new Prisma.Decimal(input.amount);
  if (valor.lte(0)) throw new ClawbackError('VALOR_INVALIDO');

  if (!process.env.STELLAR_ISSUER_SECRET) throw new ClawbackError('EMISSOR_NAO_CONFIGURADO');

  const investidor = await db.investidor.findUnique({ where: { id: input.investidorId } });
  if (!investidor) throw new ClawbackError('INVESTIDOR_NAO_ENCONTRADO');
  // Trava da carteira NO SERVIDOR: a revisada tem de ser a lida agora; antes de gravar a tentativa (o pedidoId não é consumido).
  if (input.carteiraRevisada !== undefined && input.carteiraRevisada.trim() !== investidor.publicKey) {
    throw new ClawbackError('CARTEIRA_DIVERGENTE');
  }

  const chaveLock = `plina:clawback:${input.pedidoId}`;
  const filtroPedido = { acao: 'CLAWBACK_EXECUTADO' as const, payloadJson: { path: ['pedidoId'], equals: input.pedidoId } };

  // 1) Claim do pedido (curto; sem rede dentro da transação).
  const claim = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveLock}))`;
    const existente = await tx.eventoAudit.findFirst({ where: filtroPedido });
    if (existente) return { novo: false as const, evento: existente };
    const pre = await tx.eventoAudit.create({
      data: {
        acao: 'CLAWBACK_EXECUTADO',
        operador: input.operador,
        investidorId: input.investidorId,
        motivoClawback: input.motivo,
        fundamentoUrl: input.fundamentoUrl,
        payloadJson: {
          pedidoId: input.pedidoId,
          amount: input.amount,
          targetPubkey: investidor.publicKey,
          status: 'attempting',
        } as Prisma.InputJsonValue,
      },
    });
    return { novo: true as const, evento: pre };
  });

  const eventoId = claim.evento.id;
  const guardado = (claim.evento.payloadJson ?? {}) as PayloadClawback;

  if (!claim.novo) {
    // O pedido só vale para os MESMOS dados (investidor e valor): outra combinação com a mesma chave é recusada.
    // R1 (Argus): também o motivo e o fundamento: o memo ancorado na retomada tem de ser o do REGISTRO, nunca o de um reenvio com outra URL.
    if (
      claim.evento.investidorId !== input.investidorId ||
      guardado.amount !== input.amount ||
      claim.evento.motivoClawback !== input.motivo ||
      claim.evento.fundamentoUrl !== input.fundamentoUrl
    ) {
      throw new ClawbackError('PEDIDO_INVALIDO');
    }
    if (guardado.status === 'executed') {
      return {
        txHash: claim.evento.stellarTxHash ?? guardado.clawbackTxHash ?? '',
        fundamentoTxHash: guardado.fundamentoTxHash ?? '',
        payloadHash: claim.evento.payloadHash ?? '',
        idempotente: true,
      };
    }
    if (guardado.status === 'onchain' && guardado.clawbackTxHash) {
      // Só UM reenvio conclui o registro: dois juntos mandariam dois memos do fundamento à rede (só um ficaria no registro).
      const vez = await tomarConclusaoDoClawback(eventoId, chaveLock);
      if (!vez.tomou) {
        const g = (vez.evento.payloadJson ?? {}) as PayloadClawback;
        if (g.status === 'executed') {
          return {
            txHash: vez.evento.stellarTxHash ?? g.clawbackTxHash ?? '',
            fundamentoTxHash: g.fundamentoTxHash ?? '',
            payloadHash: vez.evento.payloadHash ?? '',
            idempotente: true,
          };
        }
        throw new ClawbackError('PEDIDO_EM_ANDAMENTO');
      }
      return concluirRegistroDoClawback({ eventoId, chaveLock, input, publicKey: investidor.publicKey, clawbackTxHash: guardado.clawbackTxHash, retomada: true });
    }
    throw new ClawbackError(guardado.status === 'failed' ? 'PEDIDO_FALHOU' : guardado.status === 'incerto' ? 'EXECUCAO_INCERTA' : 'PEDIDO_EM_ANDAMENTO');
  }

  // 2) On-chain (clawback). Só quem gravou a tentativa chega aqui.
  let clawbackTxHash: string;
  try {
    clawbackTxHash = (await executeClawback(issuerSigner(), investidor.publicKey, input.amount)).hash;
  } catch (err) {
    console.error('[clawback] execução falhou', causaSegura(err));
    // R2 (Argus): só a REJEIÇÃO DEFINITIVA da rede (result_codes) prova que a tx não entrou. Timeout, 5xx, queda de conexão e
    // tx_too_late/tx_bad_seq podem ter deixado a tx entrar: ficam `incerto` (o pedido recusa, sem orientar um 2º clawback).
    const definitiva = rejeicaoDefinitivaDaRede(err);
    await db.eventoAudit
      .update({
        where: { id: eventoId },
        data: { payloadJson: { ...guardado, status: definitiva ? 'failed' : 'incerto', causa: causaSegura(err) } as unknown as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
    throw new ClawbackError(definitiva ? 'EXECUCAO_FALHOU' : 'EXECUCAO_INCERTA');
  }

  // Guarda o hash IMEDIATAMENTE: se algo cair daqui em diante, o mesmo pedido retoma o registro sem reexecutar o clawback.
  await db.eventoAudit.update({
    where: { id: eventoId },
    data: {
      stellarTxHash: clawbackTxHash,
      payloadJson: { ...guardado, status: 'onchain', clawbackTxHash, concluindoDesde: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
    },
  });

  return concluirRegistroDoClawback({ eventoId, chaveLock, input, publicKey: investidor.publicKey, clawbackTxHash, retomada: false });
}

/**
 * `true` só quando o Horizon devolveu `result_codes` (a rede REJEITOU a tx: ela não entrou). `tx_too_late` e `tx_bad_seq` não provam
 * isso (reenviar uma tx que já entrou e expirou volta tx_too_late; ver `ehTxTooLate`), e erro sem result_codes (timeout, 5xx, rede) é incerto.
 */
function rejeicaoDefinitivaDaRede(err: unknown): boolean {
  const rc = (err as { response?: { data?: { extras?: { result_codes?: { transaction?: unknown } } } } })?.response?.data?.extras?.result_codes;
  if (!rc || typeof rc !== 'object') return false;
  return rc.transaction !== 'tx_too_late' && rc.transaction !== 'tx_bad_seq';
}

/**
 * Toma a vez de concluir o registro de um clawback já na rede: transação curta sob o MESMO advisory lock do claim (sem rede dentro).
 * Só toma quem vê `onchain` sem prazo vigente (`concluindoDesde` ausente ou mais velho que PRAZO_CONCLUSAO_CLAWBACK_MS). Quem não
 * toma recebe o evento atual (se já `executed`, o chamador devolve o resultado do 1º; senão, recusa como "em andamento").
 */
async function tomarConclusaoDoClawback(eventoId: string, chaveLock: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveLock}))`;
    const evento = await tx.eventoAudit.findFirst({ where: { id: eventoId } });
    if (!evento) throw new ClawbackError('PEDIDO_EM_ANDAMENTO');
    const g = (evento.payloadJson ?? {}) as PayloadClawback;
    const desde = g.concluindoDesde ? Date.parse(g.concluindoDesde) : NaN;
    const vigente = Number.isFinite(desde) && Date.now() - desde < PRAZO_CONCLUSAO_CLAWBACK_MS;
    if (g.status !== 'onchain' || vigente) return { tomou: false as const, evento };
    const atualizado = await tx.eventoAudit.update({
      where: { id: eventoId },
      data: { payloadJson: { ...g, concluindoDesde: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
    });
    return { tomou: true as const, evento: atualizado };
  });
}

/** Solta o prazo quando a conclusão falhou (REGISTRO_PENDENTE): o reenvio seguinte do operador não espera o prazo vencer. Melhor esforço. */
async function soltarConclusaoDoClawback(eventoId: string, chaveLock: string): Promise<void> {
  await db
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveLock}))`;
      const evento = await tx.eventoAudit.findFirst({ where: { id: eventoId } });
      const g = (evento?.payloadJson ?? {}) as PayloadClawback;
      if (!evento || g.status !== 'onchain' || !g.concluindoDesde) return;
      const { concluindoDesde: _liberado, ...resto } = g;
      await tx.eventoAudit.update({ where: { id: eventoId }, data: { payloadJson: resto as unknown as Prisma.InputJsonValue } });
    })
    .catch(() => undefined);
}

/** Passos 3 e 4: memo do fundamento + (evento executado, saldoEsperado e holding) numa transação, idempotente por evento. */
async function concluirRegistroDoClawback(a: {
  eventoId: string;
  chaveLock: string;
  input: ExecutarClawbackInput;
  publicKey: string;
  clawbackTxHash: string;
  retomada: boolean;
}): Promise<ExecutarClawbackResult> {
  const { input } = a;
  let fundamentoOnChain: { txHash: string; payloadHash: string };
  try {
    // Memo.hash do fundamento (whitepaper §3.2: "fundamento jurídico vinculado, visível em Stellar Expert"): self-payment do issuer
    // com SHA-256 do payload; qualquer auditor cross-verifica `fundamentoUrl` off-chain contra o hash.
    const payload = buildAuditPayload('clawback_fundamento', input.investidorId, {
      motivo: input.motivo,
      fundamentoUrl: input.fundamentoUrl,
      targetPubkey: a.publicKey,
      amount: input.amount,
      clawbackTxHash: a.clawbackTxHash,
    });
    fundamentoOnChain = await registerOnChainHash(payload);
  } catch (err) {
    console.error('[clawback] registro do fundamento falhou', causaSegura(err));
    await soltarConclusaoDoClawback(a.eventoId, a.chaveLock);
    throw new ClawbackError('REGISTRO_PENDENTE', a.clawbackTxHash);
  }

  try {
    const jaConcluido = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.chaveLock}))`;
      const atual = await tx.eventoAudit.findFirst({ where: { id: a.eventoId } });
      if ((atual?.payloadJson as PayloadClawback | null)?.status === 'executed') return true;
      await tx.eventoAudit.update({
        where: { id: a.eventoId },
        data: {
          stellarTxHash: a.clawbackTxHash,
          payloadHash: fundamentoOnChain.payloadHash,
          payloadJson: {
            pedidoId: input.pedidoId,
            amount: input.amount,
            targetPubkey: a.publicKey,
            status: 'executed',
            clawbackTxHash: a.clawbackTxHash,
            fundamentoTxHash: fundamentoOnChain.txHash,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.investidor.update({
        where: { id: input.investidorId },
        data: { saldoEsperado: { decrement: new Prisma.Decimal(input.amount) } },
      });
      // Mantém o ledger por-classe coerente com o saldoEsperado (PRD §M3). Clawback é SENIOR-only.
      await decrementarHolding(tx, {
        investidorId: input.investidorId,
        classe: classeFromAssetCode(assetCode),
        amount: input.amount,
        txHash: a.clawbackTxHash,
      });
      return false;
    });
    return {
      txHash: a.clawbackTxHash,
      fundamentoTxHash: fundamentoOnChain.txHash,
      payloadHash: fundamentoOnChain.payloadHash,
      ...(a.retomada || jaConcluido ? { idempotente: true } : {}),
    };
  } catch (err) {
    console.error('[clawback] conclusão do registro falhou', causaSegura(err));
    await soltarConclusaoDoClawback(a.eventoId, a.chaveLock);
    throw new ClawbackError('REGISTRO_PENDENTE', a.clawbackTxHash);
  }
}

export interface AtualizarStatusCotaInput {
  cotaId: string;
  status: StatusCota;
  operador: string;
}

export async function atualizarStatusCota(input: AtualizarStatusCotaInput) {
  // EMISSAO_PENDENTE (E1-4) é do fluxo de incorporação: nem entra nem sai por
  // aqui — promover uma cota sem emissão confirmada poria ativo sem token no NAV.
  const atual = await db.cota.findUnique({
    where: { id: input.cotaId },
    select: { status: true },
  });
  if (
    input.status === StatusCota.EMISSAO_PENDENTE ||
    atual?.status === StatusCota.EMISSAO_PENDENTE
  ) {
    throw new Error('Status EMISSAO_PENDENTE só muda pela incorporação/reconciliação.');
  }
  return db.cota.update({
    where: { id: input.cotaId },
    data: { status: input.status },
  });
}

/** Chave pública do issuer (o registro amarra o emissor). Vazia → o registro recusa (fail-closed). */
function issuerPublico(): string {
  const s = issuerSigner() as { publicKey?: () => string };
  return (typeof s.publicKey === 'function' ? s.publicKey() : '') || '';
}
