/**
 * `listarOperacoesTravadas` (T3, fatia 1; SÓ LEITURA): lista as operações PARADAS das sagas do §2 do desenho, cada uma com tipo, alvo, estado,
 * idade e as ações do catálogo habilitadas para o estado. Não escreve, não chama rede, PSP nem DocuSign: só consultas ao banco.
 *
 * Sem PII: devolve ids internos (cuid, hash de memo) e o código do estado; nunca nome, e-mail, CPF, chave Pix nem destino. As consultas
 * filtram por estado e idade no banco (índices existentes) e limitam por tipo; `truncado` avisa se algum tipo bateu o limite.
 */
import { db } from '../../db';
import { acoesPermitidas, type AcaoReparo, type ClasseDeRecuperacao, type EstadoDaOperacao, type TipoOperacao } from './catalogo';
import {
  PRAZOS_PROVISORIOS as P,
  classificarCessao, classificarClawback, classificarIncorporacao, classificarOffRamp, classificarPix, classificarReservaOrfa,
  classificarSnapshotNav, type Classificacao,
} from './classificar';

export type Severidade = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface OperacaoTravada {
  tipo: TipoOperacao;
  /** Id interno do alvo (o que a futura action recebe). */
  alvoId: string;
  /** Últimos 6 caracteres, maiúsculos: para citar sem copiar o id inteiro. */
  alvoCurto: string;
  estado: EstadoDaOperacao;
  desde: Date;
  idadeMs: number;
  classe: ClasseDeRecuperacao;
  /** PROVISÓRIA (decisão c do desenho; §11.2). */
  severidade: Severidade;
  /** Ações do catálogo habilitadas para o estado (vazio = só o operador acompanha, ou o mesmo pedido retoma). */
  acoesPermitidas: AcaoReparo[];
}

export interface ResultadoDaListagem {
  itens: OperacaoTravada[];
  porTipo: Record<TipoOperacao, number>;
  /** `true` se algum tipo atingiu o limite da consulta (há mais do que o listado). */
  truncado: boolean;
}

/** Classe e severidade provisórias por estado. */
const META: Record<EstadoDaOperacao, { classe: ClasseDeRecuperacao; severidade: Severidade }> = {
  RESERVA_ORFA: { classe: 'R', severidade: 'ALTA' }, // NAV fica indisponível (SWAP_EM_VOO) enquanto houver
  ORDEM_SEM_TRANSACAO: { classe: 'P', severidade: 'MEDIA' },
  AGUARDANDO_ASSINATURA: { classe: 'R', severidade: 'BAIXA' },
  ENVIO_PRESO: { classe: 'R', severidade: 'MEDIA' },
  EM_TRANSITO_LONGO: { classe: 'I', severidade: 'MEDIA' },
  INCERTO: { classe: 'P', severidade: 'ALTA' },
  FALHOU: { classe: 'P', severidade: 'ALTA' },
  COMPROVADA_SEM_PAGAMENTO: { classe: 'P', severidade: 'BAIXA' }, // linha órfã (cessão ausente); só registro
  EMISSAO_PENDENTE: { classe: 'R', severidade: 'ALTA' }, // NAV subestimado
  EMISSAO_FALHOU: { classe: 'P', severidade: 'ALTA' },
  EMISSAO_EXPIRADA: { classe: 'P', severidade: 'ALTA' },
  PUBLICANDO_PRESO: { classe: 'R', severidade: 'MEDIA' },
  TENTATIVA_SEM_CONCLUSAO: { classe: 'P', severidade: 'ALTA' },
  NA_REDE_SEM_REGISTRO: { classe: 'R', severidade: 'ALTA' },
};
const ORDEM_SEVERIDADE: Record<Severidade, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

const curto = (id: string) => id.slice(-6).toUpperCase();

export async function listarOperacoesTravadas(opts: { agora?: Date; limitePorTipo?: number } = {}): Promise<ResultadoDaListagem> {
  const agora = opts.agora ?? new Date();
  const limite = Math.min(Math.max(opts.limitePorTipo ?? 50, 1), 200);
  const antes = (ms: number) => new Date(agora.getTime() - ms);
  const itens: OperacaoTravada[] = [];
  const porTipo = Object.fromEntries(
    (['SWAP_ORFAO', 'RESGATE_ORFAO', 'OFFRAMP', 'CESSAO', 'PIX_SAIDA', 'INCORPORACAO', 'CLAWBACK', 'SNAPSHOT_NAV'] as const).map((t) => [t, 0]),
  ) as Record<TipoOperacao, number>;
  let truncado = false;

  const juntar = (tipo: TipoOperacao, alvoId: string, c: Classificacao | null, linhas: number) => {
    if (linhas >= limite) truncado = true;
    if (!c) return;
    porTipo[tipo] += 1;
    itens.push({
      tipo, alvoId, alvoCurto: curto(alvoId), estado: c.estado, desde: c.desde, idadeMs: agora.getTime() - c.desde.getTime(),
      ...META[c.estado], acoesPermitidas: acoesPermitidas(tipo, c.estado),
    });
  };

  // 1) Reservas órfãs do swap (Quote) e do resgate (ResgateCotacao).
  const filtroReserva = { submitXdrHash: { not: null }, consumedAt: null, submitMaxTime: { lt: antes(P.reservaOrfaEsperaMs) } };
  const [quotes, resgates] = await Promise.all([
    db.quote.findMany({ where: filtroReserva, select: { id: true, submitXdrHash: true, consumedAt: true, submitMaxTime: true }, orderBy: { submitMaxTime: 'asc' }, take: limite }),
    db.resgateCotacao.findMany({ where: filtroReserva, select: { id: true, submitXdrHash: true, consumedAt: true, submitMaxTime: true }, orderBy: { submitMaxTime: 'asc' }, take: limite }),
  ]);
  quotes.forEach((q) => juntar('SWAP_ORFAO', q.id, classificarReservaOrfa(q, agora), quotes.length));
  resgates.forEach((q) => juntar('RESGATE_ORFAO', q.id, classificarReservaOrfa(q, agora), resgates.length));

  // 2) Ordens de saída em BRL sem transação.
  const offramps = await db.offRampOrder.findMany({
    where: { status: 'pending', burnStellarTxHash: null, criadoEm: { lt: antes(P.offrampSemTransacaoMs) } },
    select: { id: true, status: true, burnStellarTxHash: true, criadoEm: true }, orderBy: { criadoEm: 'asc' }, take: limite,
  });
  offramps.forEach((o) => juntar('OFFRAMP', o.id, classificarOffRamp(o, agora), offramps.length));

  // 3) Cessões: termo sem assinatura há muito, ou claim de envio ao DocuSign preso.
  const cessoes = await db.cessao.findMany({
    where: {
      OR: [
        { status: 'ENVIADA_DOCUSIGN', criadaEm: { lt: antes(P.cessaoAguardandoMs) } },
        { status: 'PENDENTE', docusignEnvelopeId: null, docusignEnvioIniciadoEm: { lt: antes(P.cessaoEnvioPresoMs) } },
      ],
    },
    select: { id: true, status: true, criadaEm: true, docusignEnvioIniciadoEm: true, docusignEnvelopeId: true }, orderBy: { criadaEm: 'asc' }, take: limite,
  });
  cessoes.forEach((c) => juntar('CESSAO', c.id, classificarCessao(c, agora), cessoes.length));

  // 4) Pix de saída: incerto, falhou, em trânsito há muito, ou comprovado sem Pagamento (a linha não tem FK para a cessão).
  const pix = await db.transferenciaPix.findMany({
    where: {
      OR: [
        { status: { in: ['INCERTO', 'FALHOU'] } },
        { status: { in: ['ENVIANDO', 'PROCESSANDO'] }, criadoEm: { lt: antes(P.pixEmTransitoMs) } },
        { status: 'COMPROVADA' },
      ],
    },
    select: { cessaoId: true, status: true, criadoEm: true }, orderBy: { criadoEm: 'asc' }, take: limite,
  });
  const comprovadas = pix.filter((t) => t.status === 'COMPROVADA').map((t) => t.cessaoId);
  const pagos = new Set(
    comprovadas.length ? (await db.pagamento.findMany({ where: { cessaoId: { in: comprovadas }, status: 'EXECUTADO' }, select: { cessaoId: true } })).map((p) => p.cessaoId) : [],
  );
  pix.forEach((t) => juntar('PIX_SAIDA', t.cessaoId, classificarPix({ status: t.status, criadoEm: t.criadoEm, temPagamento: pagos.has(t.cessaoId) }, agora), pix.length));

  // 5) Incorporação (tentativa de emissão).
  const emissoes = await db.tentativaEmissao.findMany({
    where: { OR: [{ status: { in: ['FALHOU', 'EXPIRADA'] } }, { status: 'PENDENTE', maxTime: { lt: antes(P.emissaoMargemMs) } }] },
    select: { memoHash: true, status: true, maxTime: true }, orderBy: { maxTime: 'asc' }, take: limite,
  });
  emissoes.forEach((t) => juntar('INCORPORACAO', t.memoHash, classificarIncorporacao(t, agora), emissoes.length));

  // 6) Snapshot do NAV preso em PUBLICANDO.
  const snapshots = await db.snapshotNav.findMany({
    where: { status: 'PUBLICANDO' }, select: { data: true, status: true, travaAte: true, criadoEm: true }, orderBy: { criadoEm: 'asc' }, take: limite,
  });
  snapshots.forEach((s) => juntar('SNAPSHOT_NAV', s.data, classificarSnapshotNav(s, agora), snapshots.length));

  // 7) Clawback (U1-11): estado em EventoAudit.payloadJson.status.
  const claws = await db.eventoAudit.findMany({
    where: {
      acao: 'CLAWBACK_EXECUTADO', criadoEm: { lt: antes(P.clawbackMs) },
      OR: ['attempting', 'onchain', 'incerto'].map((s) => ({ payloadJson: { path: ['status'], equals: s } })),
    },
    select: { id: true, criadoEm: true, payloadJson: true }, orderBy: { criadoEm: 'asc' }, take: limite,
  });
  claws.forEach((c) => {
    const status = String((c.payloadJson as { status?: unknown } | null)?.status ?? '');
    juntar('CLAWBACK', c.id, classificarClawback({ status, criadoEm: c.criadoEm }, agora), claws.length);
  });

  itens.sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] || a.desde.getTime() - b.desde.getTime());
  return { itens, porTipo, truncado };
}
