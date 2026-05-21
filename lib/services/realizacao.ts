/**
 * Realização service — funil comprador-usuário do bem (Maria + PJ).
 *
 * Caminho A do whitepaper §6.2: revenda da cota contemplada ao comprador
 * que vai efetivamente USAR a carta de crédito (compra imóvel/veículo/
 * equipamento). Diferencial competitivo durável da Plina.
 *
 * Fluxo de estados:
 *   1. Lead capturado (LeadComprador NOVO)
 *   2. Lead qualificado (operador → QUALIFICADO)
 *   3. Reserva criada (Cota → RESERVADA, expira 72h)
 *   4. Sinal pago (Reserva → status CONFIRMADA mas Cota segue RESERVADA)
 *   5. Transferência titularidade administradora (operador confirma)
 *   6. Caminho A executado: Cota → REALIZADA, RealizacaoCaminho persistida,
 *      NAV do pool sobe (spread capturado).
 *
 * Cada estado com prova on-chain via Memo.hash. Comprador NÃO tem wallet.
 */

import {
  CaminhoRealizacao,
  LeadCompradorStatus,
  LeadCompradorTipo,
  Prisma,
  ReservaStatus,
  StatusCota,
} from '@prisma/client';
import { db } from '../db';
import {
  buildAuditPayload,
  registerOnChainHash,
} from '../stellar/audit';

const RESERVA_DURACAO_HORAS = 72;

/** Janela de dedup pra evitar N txs Stellar por reenvio do form de lead. */
export const LEAD_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── 1. Captura de lead comprador ───────────────────────────────────────────

export interface CapturarLeadCompradorInput {
  nome: string;
  email: string;
  telefone?: string;
  documento?: string; // CPF ou CNPJ
  tipo: LeadCompradorTipo;
  intencaoBem?: string;
  faixaCapital?: string;
  prazoDecisao?: string;
  consentimentoLgpd: boolean;
  origem?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface CapturarLeadCompradorResult {
  leadId: string;
  payloadHash: string;
  txHash: string;
}

export async function capturarLeadComprador(
  input: CapturarLeadCompradorInput,
): Promise<CapturarLeadCompradorResult> {
  if (!input.consentimentoLgpd) {
    throw new Error('Consentimento LGPD obrigatório.');
  }
  if (!input.nome.trim() || !input.email.trim()) {
    throw new Error('Nome e email obrigatórios.');
  }

  const normalizedEmail = input.email.toLowerCase().trim();

  // F-21 dedup: se o lead já tem audit on-chain recente, reusar o txHash em
  // vez de submeter outra tx Stellar. Reenvio acidental do form é o caso
  // comum — sem isso, cada reload virava poluição on-chain.
  const recentAudit = await db.eventoAudit.findFirst({
    where: {
      acao: 'LEAD_COMPRADOR_CAPTURADO',
      leadComprador: { email: normalizedEmail },
      criadoEm: { gte: new Date(Date.now() - LEAD_DEDUP_WINDOW_MS) },
      stellarTxHash: { not: null },
      payloadHash: { not: null },
    },
    orderBy: { criadoEm: 'desc' },
    select: { stellarTxHash: true, payloadHash: true, payloadJson: true },
  });

  const payload = buildAuditPayload('lead_comprador', undefined, {
    email: normalizedEmail,
    tipo: input.tipo,
    intencaoBem: input.intencaoBem ?? null,
    faixaCapital: input.faixaCapital ?? null,
    consentimentoLgpd: true,
    origem: input.origem ?? 'organico',
  });
  const onChain = recentAudit?.stellarTxHash && recentAudit.payloadHash
    ? { txHash: recentAudit.stellarTxHash, payloadHash: recentAudit.payloadHash }
    : await registerOnChainHash(payload);

  const lead = await db.$transaction(async (tx) => {
    const upserted = await tx.leadComprador.upsert({
      where: { email: normalizedEmail },
      create: {
        nome: input.nome.trim(),
        email: normalizedEmail,
        telefone: input.telefone?.trim() || null,
        documento: input.documento?.replace(/\D/g, '') || null,
        tipo: input.tipo,
        intencaoBem: input.intencaoBem?.trim() || null,
        faixaCapital: input.faixaCapital?.trim() || null,
        prazoDecisao: input.prazoDecisao?.trim() || null,
        origem: input.origem ?? 'organico',
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        status: LeadCompradorStatus.NOVO,
      },
      update: {
        nome: input.nome.trim(),
        telefone: input.telefone?.trim() || undefined,
        intencaoBem: input.intencaoBem?.trim() || undefined,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'LEAD_COMPRADOR_CAPTURADO',
        operador: 'self-service',
        leadCompradorId: upserted.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return upserted;
  });

  return {
    leadId: lead.id,
    payloadHash: onChain.payloadHash,
    txHash: onChain.txHash,
  };
}

// ─── 2. Cotas disponíveis pra compra ────────────────────────────────────────

export async function listarCotasParaCompra() {
  return db.cota.findMany({
    where: {
      status: StatusCota.DISPONIVEL,
      desagioRevenda: { not: null },
    },
    orderBy: { criadaEm: 'desc' },
    select: {
      id: true,
      tipoBem: true,
      valorCarta: true,
      desagioRevenda: true,
      localizacaoAprox: true,
      prazoRestanteMeses: true,
      caminhoPrevisto: true,
      statusEstoque: true,
      // administradora NÃO retornada (whitepaper: exposta só pós-qualificação).
    },
  });
}

// ─── 3. Reserva ─────────────────────────────────────────────────────────────

export interface CriarReservaInput {
  cotaId: string;
  leadCompradorId: string;
  sinalSimulado?: string;
}

export interface CriarReservaResult {
  reservaId: string;
  expiraEm: Date;
  payloadHash: string;
  txHash: string;
}

export async function criarReserva(
  input: CriarReservaInput,
): Promise<CriarReservaResult> {
  const [cota, lead] = await Promise.all([
    db.cota.findUnique({ where: { id: input.cotaId } }),
    db.leadComprador.findUnique({ where: { id: input.leadCompradorId } }),
  ]);
  if (!cota) throw new Error('Cota não encontrada');
  if (!lead) throw new Error('Lead comprador não encontrado');
  if (cota.status !== StatusCota.DISPONIVEL) {
    throw new Error(`Cota em estado ${cota.status} — não reservável`);
  }
  if (!cota.desagioRevenda) {
    throw new Error('Cota sem deságio de revenda definido');
  }

  const expiraEm = new Date(Date.now() + RESERVA_DURACAO_HORAS * 3600 * 1000);
  const sinal = input.sinalSimulado ?? '0';
  const valorRevenda = Math.floor(
    Number(cota.valorCarta) * (1 - Number(cota.desagioRevenda)),
  );

  const payload = buildAuditPayload('reserva', input.cotaId, {
    cotaId: input.cotaId,
    leadCompradorId: input.leadCompradorId,
    valorRevendaEstimado: valorRevenda,
    sinalSimulado: sinal,
    expiraEm: expiraEm.toISOString(),
  });
  const onChain = await registerOnChainHash(payload);

  const reserva = await db.$transaction(async (tx) => {
    const created = await tx.reserva.create({
      data: {
        cotaId: input.cotaId,
        leadCompradorId: input.leadCompradorId,
        sinalSimulado: sinal,
        expiraEm,
        onChainTxHash: onChain.txHash,
        status: ReservaStatus.ATIVA,
      },
    });
    await tx.cota.update({
      where: { id: input.cotaId },
      data: { status: StatusCota.RESERVADA },
    });
    await tx.leadComprador.update({
      where: { id: input.leadCompradorId },
      data: { status: LeadCompradorStatus.RESERVOU },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'RESERVA_CRIADA',
        operador: 'self-service',
        cotaId: input.cotaId,
        leadCompradorId: input.leadCompradorId,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return created;
  });

  return {
    reservaId: reserva.id,
    expiraEm,
    payloadHash: onChain.payloadHash,
    txHash: onChain.txHash,
  };
}

/** Cancela uma reserva ativa. Libera a cota de volta pra DISPONIVEL. */
export async function cancelarReserva(reservaId: string, operador: string) {
  const reserva = await db.reserva.findUnique({
    where: { id: reservaId },
    include: { cota: true },
  });
  if (!reserva) throw new Error('Reserva não encontrada');
  if (reserva.status !== ReservaStatus.ATIVA) {
    throw new Error(`Reserva em estado ${reserva.status} — não cancelável`);
  }

  await db.$transaction(async (tx) => {
    await tx.reserva.update({
      where: { id: reservaId },
      data: { status: ReservaStatus.CANCELADA },
    });
    if (reserva.cota.status === StatusCota.RESERVADA) {
      await tx.cota.update({
        where: { id: reserva.cotaId },
        data: { status: StatusCota.DISPONIVEL },
      });
    }
  });
}

// ─── 4. Caminho A executado ─────────────────────────────────────────────────

export interface ExecutarCaminhoAInput {
  reservaId: string;
  valorRealizado: string; // BRL efetivamente pago pelo comprador
  operador: string;
}

export interface ExecutarCaminhoAResult {
  realizacaoId: string;
  spread: string;
  payloadHash: string;
  txHash: string;
}

/**
 * Executa Caminho A: comprador-usuário paga, transferência efetiva,
 * Cota → REALIZADA, RealizacaoCaminho persistida com spread, audit
 * on-chain do hash completo. NAV/token sobe pra holders.
 *
 * No MVP testnet: o "pagamento" é simulado. Em mainnet, o fluxo é:
 *   - Comprador deposita BRL na conta Plina
 *   - Operador confirma transferência de titularidade na administradora
 *   - Esta função executa o close-out: cota sai do pool, spread capturado.
 */
export async function executarCaminhoA(
  input: ExecutarCaminhoAInput,
): Promise<ExecutarCaminhoAResult> {
  const reserva = await db.reserva.findUnique({
    where: { id: input.reservaId },
    include: {
      cota: true,
      leadComprador: true,
    },
  });
  if (!reserva) throw new Error('Reserva não encontrada');
  if (reserva.status !== ReservaStatus.ATIVA) {
    throw new Error(`Reserva em estado ${reserva.status}`);
  }
  if (reserva.cota.status !== StatusCota.RESERVADA) {
    throw new Error(`Cota em estado ${reserva.cota.status} — esperado RESERVADA`);
  }

  let valorRealizado: Prisma.Decimal;
  try {
    valorRealizado = new Prisma.Decimal(input.valorRealizado);
  } catch {
    throw new Error('valorRealizado inválido');
  }
  if (!valorRealizado.isFinite() || valorRealizado.lte(0)) {
    throw new Error('valorRealizado inválido');
  }

  // Custo de aquisição = NAV original (valorCarta × (1 - desagioAquisicao))
  // Decimal pipeline: evita truncamento IEEE-754 + composição de erros.
  const valorCartaDec = new Prisma.Decimal(reserva.cota.valorCarta);
  const desagioDec = new Prisma.Decimal(reserva.cota.desagioAquisicao);
  const custoAquisicao = valorCartaDec
    .mul(new Prisma.Decimal(1).minus(desagioDec))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
  const spread = valorRealizado.minus(custoAquisicao);

  const payload = buildAuditPayload('caminho_a', reserva.cotaId, {
    cotaId: reserva.cotaId,
    reservaId: reserva.id,
    leadCompradorId: reserva.leadCompradorId,
    valorRealizado: valorRealizado.toFixed(2),
    custoAquisicao: custoAquisicao.toFixed(2),
    spread: spread.toFixed(2),
    caminho: 'A_REVENDA',
  });
  const onChain = await registerOnChainHash(payload);

  const realizacao = await db.$transaction(async (tx) => {
    const created = await tx.realizacaoCaminho.create({
      data: {
        cotaId: reserva.cotaId,
        caminho: CaminhoRealizacao.A_REVENDA,
        leadCompradorId: reserva.leadCompradorId,
        valorRealizado: valorRealizado.toFixed(2),
        custoAquisicao: custoAquisicao.toFixed(2),
        spread: spread.toFixed(2),
        onChainTxHash: onChain.txHash,
        operador: input.operador,
      },
    });
    await tx.cota.update({
      where: { id: reserva.cotaId },
      data: { status: StatusCota.REALIZADA },
    });
    await tx.reserva.update({
      where: { id: reserva.id },
      data: { status: ReservaStatus.CONFIRMADA },
    });
    await tx.leadComprador.update({
      where: { id: reserva.leadCompradorId },
      data: { status: LeadCompradorStatus.FECHOU },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'CAMINHO_A_EXECUTADO',
        operador: input.operador,
        cotaId: reserva.cotaId,
        leadCompradorId: reserva.leadCompradorId,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'COTA_REALIZADA',
        operador: input.operador,
        cotaId: reserva.cotaId,
        leadCompradorId: reserva.leadCompradorId,
        stellarTxHash: onChain.txHash,
        payloadJson: {
          caminho: 'A_REVENDA',
          spread: spread.toFixed(2),
        } as Prisma.InputJsonValue,
      },
    });
    return created;
  });

  return {
    realizacaoId: realizacao.id,
    spread: spread.toFixed(2),
    payloadHash: onChain.payloadHash,
    txHash: onChain.txHash,
  };
}
