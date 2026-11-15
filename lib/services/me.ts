/**
 * "Minha conta" (item 12, contrato contratos/2026-11-15-me-resumo-historico.md): resumo e histórico da PRÓPRIA Pessoa. Só LEITURA.
 * Tudo parte de `pessoaId` da sessão (nunca de um id vindo da requisição). Sem PII: nem CPF, chave Pix, e-mail nem nome de
 * terceiros; do `payloadJson` só se leem `amount`, `amountPlinarf`, `brlEquivalente`, `quoteId` e `mock`, e nada dele é repassado.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { STELLAR_NETWORK } from '../stellar/config';
import { isSorobanWaterfallEnabled } from '../env/feature-gates';
import { lerSupplyDoNav, NavIndisponivelError } from './nav-supply';
import { navPorTokenAsDecimal } from './pool';
import { caixaParaNav } from './razao-fundo';
import { etapaDoStatus } from '../vender/etapas';
import { nomeDoCedente } from '../vender/nome';
import type { AuthedPessoa } from '../wallet/pessoa-auth';

const LIMITE_SOLICITACOES = 20;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface PosicaoResumo {
  tokens: string;
  navPorToken: string | null;
  valorPeloNav: string | null;
  navFonte: 'ledger' | 'soroban' | null;
  snapshotEm: string | null;
  snapshotTxHash: string | null;
  navIndisponivel?: true;
}

export interface ResumoDaConta {
  nome: string | null;
  papeis: string[];
  posicao: PosicaoResumo | null;
  solicitacoes: Array<{
    id: string;
    status: string;
    etapa: number;
    tipoBem: string | null;
    valorCarta: string | null;
    valorLiquido: string | null;
    ofertaValidade: string | null;
    cessaoStatus: string | null;
  }>;
  operacoesPendentes: Array<{
    tipo: 'entrada' | 'saida';
    valor: string;
    situacao: 'em_conferencia' | 'aguardando_assinatura';
    continuarEm: '/investir' | '/sacar';
  }>;
  bloqueio: null | { motivo: 'kyc_pendente' | 'conta_suspensa' };
}

async function posicaoDoInvestidor(investidorId: string): Promise<PosicaoResumo> {
  const [holding, snap] = await Promise.all([
    db.holdingPLINARF.findUnique({
      where: { investidorId_classe: { investidorId, classe: 'SENIOR' } },
      select: { saldo: true },
    }),
    db.snapshotNav.findFirst({
      where: { status: 'PUBLICADO' },
      orderBy: { publicadoEm: 'desc' },
      select: { publicadoEm: true, txHash: true },
    }),
  ]);
  const tokens = D(holding?.saldo ?? 0);
  const base = {
    tokens: tokens.toFixed(7),
    snapshotEm: snap?.publicadoEm ? snap.publicadoEm.toISOString() : null,
    snapshotTxHash: snap?.txHash ?? null,
  };
  try {
    // O MESMO cálculo e a mesma trava de /api/pool/summary: sem supply do ledger não há NAV (fail-closed).
    const supply = (await lerSupplyDoNav()).senior;
    const [cotas, caixaNav, soroban] = await Promise.all([
      db.cota.findMany({
        where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
        select: { valorCarta: true, desagioAquisicao: true, tokensEmitidos: true, status: true },
      }),
      caixaParaNav(),
      isSorobanWaterfallEnabled(),
    ]);
    const nav = navPorTokenAsDecimal(cotas, caixaNav, supply);
    return {
      ...base,
      navPorToken: nav.toFixed(8),
      valorPeloNav: tokens.mul(nav).toFixed(2),
      navFonte: soroban ? 'soroban' : 'ledger',
    };
  } catch (err) {
    // Nunca 1 nem 0 no lugar: a tela mostra "NAV indisponível". Só o motivo vai ao log (sem mensagem da causa).
    console.error('[me/resumo] NAV indisponível', err instanceof NavIndisponivelError ? err.motivo : 'DESCONHECIDO');
    return { ...base, navPorToken: null, valorPeloNav: null, navFonte: null, navIndisponivel: true };
  }
}

async function pendenciasDoInvestidor(investidorId: string): Promise<ResumoDaConta['operacoesPendentes']> {
  const agora = new Date();
  const [swaps, resgates] = await Promise.all([
    db.quote.findMany({
      where: {
        investidorId,
        consumedAt: null,
        plinarfAmount: { not: null },
        OR: [{ submitXdrHash: { not: null } }, { expiresAt: { gt: agora }, onRampOrder: { is: { status: 'completed' } } }],
      },
      select: { fromAmount: true, submitXdrHash: true },
    }),
    db.resgateCotacao.findMany({
      where: { investidorId, consumedAt: null, OR: [{ submitXdrHash: { not: null } }, { expiresAt: { gt: agora } }] },
      select: { brlEquivalente: true, submitXdrHash: true },
    }),
  ]);
  return [
    ...swaps.map((q) => ({
      tipo: 'entrada' as const,
      valor: D(q.fromAmount).toFixed(2),
      situacao: q.submitXdrHash ? ('em_conferencia' as const) : ('aguardando_assinatura' as const),
      continuarEm: '/investir' as const,
    })),
    ...resgates.map((r) => ({
      tipo: 'saida' as const,
      valor: D(r.brlEquivalente).toFixed(2),
      situacao: r.submitXdrHash ? ('em_conferencia' as const) : ('aguardando_assinatura' as const),
      continuarEm: '/sacar' as const,
    })),
  ];
}

export async function montarResumo(user: AuthedPessoa): Promise<ResumoDaConta> {
  const nome = nomeDoCedente(user.nome);
  const papeis = user.papeis.map(String);
  // Pré-KYC: ainda não existe Pessoa, logo nada está ligado a ela.
  if (!user.pessoaId) {
    return { nome, papeis, posicao: null, solicitacoes: [], operacoesPendentes: [], bloqueio: { motivo: 'kyc_pendente' } };
  }

  const [investidor, leads] = await Promise.all([
    db.investidor.findUnique({ where: { pessoaId: user.pessoaId }, select: { id: true, status: true } }),
    db.leadVendedor.findMany({
      where: { pessoaId: user.pessoaId, status: { notIn: ['PERDIDO', 'COTA_INCORPORADA'] } },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE_SOLICITACOES,
      select: {
        id: true,
        status: true,
        ofertas: {
          orderBy: { criadaEm: 'desc' },
          take: 1,
          select: {
            tipoBem: true,
            valorCarta: true,
            valorLiquidoVendedor: true,
            validade: true,
            cessao: { select: { status: true } },
          },
        },
      },
    }),
  ]);

  const [posicao, operacoesPendentes] = investidor
    ? await Promise.all([posicaoDoInvestidor(investidor.id), pendenciasDoInvestidor(investidor.id)])
    : [null, []];

  return {
    nome,
    papeis,
    posicao,
    solicitacoes: leads.map((l) => {
      const o = l.ofertas[0] ?? null;
      return {
        id: l.id,
        status: l.status,
        etapa: etapaDoStatus(l.status),
        tipoBem: o?.tipoBem ?? null,
        valorCarta: o ? D(o.valorCarta).toFixed(2) : null,
        valorLiquido: o ? D(o.valorLiquidoVendedor).toFixed(2) : null,
        ofertaValidade: o ? o.validade.toISOString() : null,
        cessaoStatus: o?.cessao?.status ?? null,
      };
    }),
    operacoesPendentes,
    bloqueio: investidor?.status === 'REVOGADO' ? { motivo: 'conta_suspensa' } : user.kycAprovado ? null : { motivo: 'kyc_pendente' },
  };
}

// ─── Histórico ───────────────────────────────────────────────────────────────────────────────────────────────────

export type TipoEventoHistorico =
  | 'solicitacao_enviada'
  | 'proposta_recebida'
  | 'proposta_aceita'
  | 'cessao_assinada'
  | 'pix_enviado'
  | 'cota_incorporada'
  | 'entrada_no_pool'
  | 'saida_do_pool';

const TIPO_POR_ACAO: Record<string, { tipo: TipoEventoHistorico; lado: 'vender' | 'investir' }> = {
  LEAD_VENDEDOR_CAPTURADO: { tipo: 'solicitacao_enviada', lado: 'vender' },
  OFERTA_GERADA: { tipo: 'proposta_recebida', lado: 'vender' },
  OFERTA_ACEITA: { tipo: 'proposta_aceita', lado: 'vender' },
  CESSAO_ASSINADA: { tipo: 'cessao_assinada', lado: 'vender' },
  PIX_SIMULADO_EXECUTADO: { tipo: 'pix_enviado', lado: 'vender' },
  PIX_SANDBOX_EXECUTADO: { tipo: 'pix_enviado', lado: 'vender' },
  PIX_REAL_EXECUTADO: { tipo: 'pix_enviado', lado: 'vender' },
  COTA_INCORPORADA: { tipo: 'cota_incorporada', lado: 'vender' },
  SWAP_EXECUTADO: { tipo: 'entrada_no_pool', lado: 'investir' },
  PLINARF_LIQUIDADO: { tipo: 'saida_do_pool', lado: 'investir' },
};
const ACOES_VENDER = Object.entries(TIPO_POR_ACAO).filter(([, v]) => v.lado === 'vender').map(([k]) => k);
const ACOES_INVESTIR = Object.entries(TIPO_POR_ACAO).filter(([, v]) => v.lado === 'investir').map(([k]) => k);
/** Tipos cujo valor é o líquido da oferta do lead. */
const COM_VALOR_DA_OFERTA = new Set<TipoEventoHistorico>(['proposta_recebida', 'proposta_aceita', 'cessao_assinada', 'pix_enviado', 'cota_incorporada']);

export interface ItemHistorico {
  id: string;
  tipo: TipoEventoHistorico;
  em: string;
  lado: 'vender' | 'investir';
  valorBrl: string | null;
  tokens: string | null;
  situacao: 'concluido';
  txHash: string | null;
  referencia: string | null;
  link: string | null;
  simulado: boolean;
}

export class CursorInvalidoError extends Error {
  constructor() {
    super('cursor inválido');
    this.name = 'CursorInvalidoError';
  }
}

export function codificarCursor(c: { em: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: c.em.toISOString(), i: c.id }), 'utf8').toString('base64url');
}

export function decodificarCursor(raw: string): { em: Date; id: string } {
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    const em = new Date(String(o.t));
    if (typeof o.i !== 'string' || !o.i || Number.isNaN(em.getTime())) throw new Error('x');
    return { em, id: o.i };
  } catch {
    throw new CursorInvalidoError();
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
function decimalOuNull(v: unknown, casas: number): string | null {
  const t = typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  if (!t) return null;
  try {
    return D(t).toFixed(casas);
  } catch {
    return null;
  }
}

export async function montarHistorico(
  user: AuthedPessoa,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ itens: ItemHistorico[]; proximoCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const cursor = opts.cursor ? decodificarCursor(opts.cursor) : null; // inválido → CursorInvalidoError (a rota responde 400)
  if (!user.pessoaId) return { itens: [], proximoCursor: null };

  const [investidor, leads] = await Promise.all([
    db.investidor.findUnique({ where: { pessoaId: user.pessoaId }, select: { id: true } }),
    db.leadVendedor.findMany({ where: { pessoaId: user.pessoaId }, select: { id: true } }),
  ]);
  const leadIds = leads.map((l) => l.id);
  const ramos: Prisma.EventoAuditWhereInput[] = [];
  if (leadIds.length > 0) ramos.push({ leadVendedorId: { in: leadIds }, acao: { in: ACOES_VENDER as never[] } });
  if (investidor) ramos.push({ investidorId: investidor.id, acao: { in: ACOES_INVESTIR as never[] } });
  if (ramos.length === 0) return { itens: [], proximoCursor: null };

  const eventos = await db.eventoAudit.findMany({
    where: {
      AND: [
        { OR: ramos },
        ...(cursor ? [{ OR: [{ criadoEm: { lt: cursor.em } }, { criadoEm: cursor.em, id: { lt: cursor.id } }] }] : []),
      ],
    },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: { id: true, acao: true, criadoEm: true, stellarTxHash: true, leadVendedorId: true, cessaoId: true, payloadJson: true },
  });
  const temMais = eventos.length > limit;
  const pagina = temMais ? eventos.slice(0, limit) : eventos;

  // Enriquecimento em lote (sem N+1): líquido da oferta (vender) e valor pago da cotação (entrada).
  const leadsDaPagina = [...new Set(pagina.map((e) => e.leadVendedorId).filter((x): x is string => !!x))];
  const quoteIds = [
    ...new Set(
      pagina
        .filter((e) => e.acao === 'SWAP_EXECUTADO')
        .map((e) => texto((e.payloadJson as Record<string, unknown> | null)?.quoteId))
        .filter((x): x is string => !!x),
    ),
  ];
  const [ofertas, quotes] = await Promise.all([
    leadsDaPagina.length
      ? db.oferta.findMany({
          where: { leadVendedorId: { in: leadsDaPagina } },
          orderBy: { criadaEm: 'desc' },
          select: { leadVendedorId: true, valorLiquidoVendedor: true },
        })
      : Promise.resolve([]),
    quoteIds.length && investidor
      ? db.quote.findMany({ where: { id: { in: quoteIds }, investidorId: investidor.id }, select: { id: true, fromAmount: true } })
      : Promise.resolve([]),
  ]);
  const liquidoPorLead = new Map<string, Prisma.Decimal>();
  for (const o of ofertas) if (!liquidoPorLead.has(o.leadVendedorId)) liquidoPorLead.set(o.leadVendedorId, D(o.valorLiquidoVendedor));
  const pagoPorQuote = new Map(quotes.map((q) => [q.id, D(q.fromAmount)]));

  const itens: ItemHistorico[] = pagina.map((e) => {
    const { tipo, lado } = TIPO_POR_ACAO[e.acao];
    const p = (e.payloadJson ?? {}) as Record<string, unknown>;
    let valorBrl: string | null = null;
    let tokens: string | null = null;
    if (COM_VALOR_DA_OFERTA.has(tipo) && e.leadVendedorId) valorBrl = liquidoPorLead.get(e.leadVendedorId)?.toFixed(2) ?? null;
    if (tipo === 'entrada_no_pool') {
      tokens = decimalOuNull(p.amount, 7);
      const q = texto(p.quoteId);
      valorBrl = q ? (pagoPorQuote.get(q)?.toFixed(2) ?? null) : null;
    }
    if (tipo === 'saida_do_pool') {
      tokens = decimalOuNull(p.amountPlinarf, 7);
      valorBrl = decimalOuNull(p.brlEquivalente, 2);
    }
    const lead = e.leadVendedorId;
    return {
      id: e.id,
      tipo,
      em: e.criadoEm.toISOString(),
      lado,
      valorBrl,
      tokens,
      situacao: 'concluido' as const,
      txHash: e.stellarTxHash ?? null,
      referencia: lead ? lead.slice(-6).toUpperCase() : null,
      link: lado === 'investir' || !lead ? null : tipo === 'pix_enviado' && e.cessaoId ? `/cessao/${e.cessaoId}/comprovante` : `/vender/acompanhar/${lead}`,
      simulado: e.acao === 'PIX_SIMULADO_EXECUTADO' || p.mock === true || STELLAR_NETWORK !== 'PUBLIC',
    };
  });

  const ultimo = pagina[pagina.length - 1];
  return { itens, proximoCursor: temMais && ultimo ? codificarCursor({ em: ultimo.criadoEm, id: ultimo.id }) : null };
}
