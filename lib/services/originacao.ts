/**
 * Originação service — funil vendedor (Ricardo).
 *
 * Cada estado-marco grava EventoAudit + opcionalmente registra prova
 * on-chain via Memo.hash (whitepaper §6.1).
 *
 * Estados que vão pra blockchain como prova pública:
 *   - LEAD_VENDEDOR_CAPTURADO (hash do consentimento LGPD)
 *   - OFERTA_ACEITA (hash da oferta + aceite)
 *   - CESSAO_ASSINADA (hash do PDF assinado via DocuSign)
 *   - PIX_SIMULADO_EXECUTADO (hash do comprovante)
 *
 * Pix simulado em testnet, real em mainnet — adapter pluggable futuro.
 * DocuSign sandbox no MVP — `docusignEnvelopeId` fica null no stub.
 */

import { Prisma, TipoBem, OfertaStatus, CessaoStatus, PagamentoStatus, LeadVendedorStatus } from '@prisma/client';
import { db } from '../db';
import {
  buildAuditPayload,
  registerOnChainHash,
  sha256OfPayload,
} from '../stellar/audit';
import { incorporarCota } from './tokenizacao';
import { tokensParaEmitir } from './pool';

// ─── 1. Captura de lead ─────────────────────────────────────────────────────

export interface CapturarLeadInput {
  nome: string;
  email: string;
  telefone?: string;
  cpf?: string;
  origem?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  consentimentoLgpd: boolean;
}

export interface CapturarLeadResult {
  leadId: string;
  payloadHash: string;
  txHash: string;
}

export async function capturarLead(
  input: CapturarLeadInput,
): Promise<CapturarLeadResult> {
  if (!input.consentimentoLgpd) {
    throw new Error('Consentimento LGPD obrigatório.');
  }
  if (!input.nome.trim() || !input.email.trim()) {
    throw new Error('Nome e email obrigatórios.');
  }

  // 1. Prova on-chain do consentimento (audit primeiro, DB depois).
  const payload = buildAuditPayload('lead_vendedor', undefined, {
    email: input.email.toLowerCase().trim(),
    consentimentoLgpd: true,
    origem: input.origem ?? 'organico',
    utm: {
      source: input.utmSource ?? null,
      medium: input.utmMedium ?? null,
      campaign: input.utmCampaign ?? null,
    },
  });
  const onChain = await registerOnChainHash(payload);

  // 2. Persiste lead + audit log.
  const lead = await db.$transaction(async (tx) => {
    const created = await tx.leadVendedor.upsert({
      where: { email: input.email.toLowerCase().trim() },
      create: {
        nome: input.nome.trim(),
        email: input.email.toLowerCase().trim(),
        telefone: input.telefone?.trim() || null,
        cpf: input.cpf?.replace(/\D/g, '') || null,
        origem: input.origem ?? 'organico',
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        status: 'NOVO',
      },
      update: {
        nome: input.nome.trim(),
        telefone: input.telefone?.trim() || undefined,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'LEAD_VENDEDOR_CAPTURADO',
        operador: 'self-service',
        leadVendedorId: created.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return created;
  });

  return {
    leadId: lead.id,
    payloadHash: onChain.payloadHash,
    txHash: onChain.txHash,
  };
}

// ─── 2. Cálculo + geração de oferta firme ───────────────────────────────────

export interface CalcularFaixaInput {
  tipoBem: TipoBem;
  administradora: string;
  valorCarta: string;
  prazoRestanteMeses?: number;
}

export interface CalcularFaixaResult {
  desagioMinimo: number;
  desagioMaximo: number;
  valorLiquidoMinimo: number;
  valorLiquidoMaximo: number;
}

/**
 * Faixa indicativa (não firme). Default ranges por tipo de bem baseados
 * em PRD_MVP §2.1 ("faixas hipotéticas de unit economics"). Modelo de
 * pricing real entra na decisão pendente do MVP (planilha versionada).
 */
export function calcularFaixaIndicativa(
  input: CalcularFaixaInput,
): CalcularFaixaResult {
  const ranges: Record<TipoBem, { min: number; max: number }> = {
    IMOVEL: { min: 0.15, max: 0.22 },
    VEICULO: { min: 0.18, max: 0.28 },
    EQUIPAMENTO: { min: 0.18, max: 0.25 },
    SERVICO: { min: 0.2, max: 0.3 },
  };
  const r = ranges[input.tipoBem] ?? { min: 0.15, max: 0.25 };
  const valor = Number(input.valorCarta);
  return {
    desagioMinimo: r.min,
    desagioMaximo: r.max,
    valorLiquidoMinimo: Math.floor(valor * (1 - r.max)),
    valorLiquidoMaximo: Math.floor(valor * (1 - r.min)),
  };
}

export interface GerarOfertaInput {
  leadVendedorId: string;
  tipoBem: TipoBem;
  valorCarta: string;
  administradora: string;
  desagioAquisicao: string;
  prazoRestanteMeses?: number;
  validadeHoras?: number;
  operador: string;
}

export async function gerarOferta(input: GerarOfertaInput) {
  const valor = Number(input.valorCarta);
  const desagio = Number(input.desagioAquisicao);
  if (!isFinite(valor) || valor <= 0) throw new Error('valorCarta inválido');
  if (!isFinite(desagio) || desagio < 0 || desagio > 1)
    throw new Error('desagioAquisicao fora de [0, 1]');

  const valorLiquido = Math.floor(valor * (1 - desagio));
  const validade = new Date(Date.now() + (input.validadeHoras ?? 48) * 3600 * 1000);

  const existingVersions = await db.oferta.count({
    where: { leadVendedorId: input.leadVendedorId },
  });

  const oferta = await db.$transaction(async (tx) => {
    const created = await tx.oferta.create({
      data: {
        leadVendedorId: input.leadVendedorId,
        tipoBem: input.tipoBem,
        valorCarta: input.valorCarta,
        administradora: input.administradora,
        desagioAquisicao: input.desagioAquisicao,
        valorLiquidoVendedor: valorLiquido.toFixed(2),
        prazoRestanteMeses: input.prazoRestanteMeses ?? null,
        validade,
        status: OfertaStatus.ENVIADA,
        versao: existingVersions + 1,
      },
    });
    await tx.leadVendedor.update({
      where: { id: input.leadVendedorId },
      data: { status: LeadVendedorStatus.OFERTA_ENVIADA },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'OFERTA_GERADA',
        operador: input.operador,
        leadVendedorId: input.leadVendedorId,
        ofertaId: created.id,
        payloadJson: {
          versao: existingVersions + 1,
          valorCarta: input.valorCarta,
          desagioAquisicao: input.desagioAquisicao,
          valorLiquido: valorLiquido.toFixed(2),
          validade: validade.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    return created;
  });

  return oferta;
}

// ─── 3. Aceite da oferta (vendedor) ─────────────────────────────────────────

export async function aceitarOferta(ofertaId: string) {
  const oferta = await db.oferta.findUnique({ where: { id: ofertaId } });
  if (!oferta) throw new Error('Oferta não encontrada');
  if (oferta.status !== OfertaStatus.ENVIADA) {
    throw new Error(`Oferta em estado ${oferta.status} — não aceitável`);
  }
  if (oferta.validade < new Date()) {
    await db.oferta.update({
      where: { id: ofertaId },
      data: { status: OfertaStatus.EXPIRADA },
    });
    throw new Error('Oferta expirada');
  }

  // Prova on-chain do aceite (hash do contrato comercial implícito).
  const payload = buildAuditPayload('oferta_aceita', ofertaId, {
    leadVendedorId: oferta.leadVendedorId,
    valorCarta: oferta.valorCarta.toString(),
    desagioAquisicao: oferta.desagioAquisicao.toString(),
    valorLiquidoVendedor: oferta.valorLiquidoVendedor.toString(),
    versao: oferta.versao,
  });
  const onChain = await registerOnChainHash(payload);

  await db.$transaction(async (tx) => {
    await tx.oferta.update({
      where: { id: ofertaId },
      data: { status: OfertaStatus.ACEITA },
    });
    await tx.leadVendedor.update({
      where: { id: oferta.leadVendedorId },
      data: { status: LeadVendedorStatus.OFERTA_ACEITA },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'OFERTA_ACEITA',
        operador: 'self-service',
        leadVendedorId: oferta.leadVendedorId,
        ofertaId: oferta.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
  });

  return { txHash: onChain.txHash, payloadHash: onChain.payloadHash };
}

// ─── 4. Cessão (DocuSign sandbox stub) ──────────────────────────────────────

export async function registrarCessao(input: {
  ofertaId: string;
  /// PDF base64 ou URL — no MVP testnet usamos placeholder.
  /// Em produção, DocuSign envelope id ja confirmaria assinatura.
  documentoBase64?: string;
  operador: string;
}) {
  const oferta = await db.oferta.findUnique({
    where: { id: input.ofertaId },
    include: { cessao: true },
  });
  if (!oferta) throw new Error('Oferta não encontrada');
  if (oferta.status !== OfertaStatus.ACEITA) {
    throw new Error('Oferta precisa estar ACEITA antes de cessão');
  }
  if (oferta.cessao) throw new Error('Cessão já registrada');

  // Hash do documento (placeholder no MVP — PDF real no Fase 1).
  const documentoBytes =
    input.documentoBase64 ??
    `cessao-mvp:${oferta.id}:${oferta.leadVendedorId}:${oferta.valorLiquidoVendedor.toString()}`;
  const hashDocumento = sha256OfPayload({ bytes: documentoBytes });

  // Prova on-chain.
  const payload = buildAuditPayload('cessao', oferta.id, {
    leadVendedorId: oferta.leadVendedorId,
    ofertaId: oferta.id,
    hashDocumento,
    valorLiquido: oferta.valorLiquidoVendedor.toString(),
  });
  const onChain = await registerOnChainHash(payload);

  const cessao = await db.$transaction(async (tx) => {
    const created = await tx.cessao.create({
      data: {
        ofertaId: oferta.id,
        docusignEnvelopeId: `mvp-stub:${oferta.id.slice(0, 12)}`,
        hashDocumento,
        onChainTxHash: onChain.txHash,
        assinadaEm: new Date(),
        status: CessaoStatus.ASSINADA,
      },
    });
    await tx.leadVendedor.update({
      where: { id: oferta.leadVendedorId },
      data: { status: LeadVendedorStatus.CESSAO_ASSINADA },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'CESSAO_ASSINADA',
        operador: input.operador,
        leadVendedorId: oferta.leadVendedorId,
        ofertaId: oferta.id,
        cessaoId: created.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return created;
  });

  return { cessaoId: cessao.id, hashDocumento, ...onChain };
}

// ─── 5. Pix simulado ────────────────────────────────────────────────────────

export async function executarPixSimulado(input: {
  cessaoId: string;
  operador: string;
}) {
  const cessao = await db.cessao.findUnique({
    where: { id: input.cessaoId },
    include: { oferta: true, pagamento: true },
  });
  if (!cessao) throw new Error('Cessão não encontrada');
  if (cessao.status !== CessaoStatus.ASSINADA) {
    throw new Error('Cessão precisa estar ASSINADA antes do Pix');
  }
  if (cessao.pagamento?.status === PagamentoStatus.EXECUTADO) {
    throw new Error('Pix já executado pra esta cessão');
  }

  const valor = cessao.oferta.valorLiquidoVendedor.toString();
  const payload = buildAuditPayload('pix_simulado', cessao.id, {
    cessaoId: cessao.id,
    ofertaId: cessao.ofertaId,
    valor,
    metodo: 'PIX_SIMULADO',
  });
  const onChain = await registerOnChainHash(payload);

  const pagamento = await db.$transaction(async (tx) => {
    const created = await tx.pagamento.upsert({
      where: { cessaoId: cessao.id },
      create: {
        cessaoId: cessao.id,
        metodo: 'PIX_SIMULADO',
        valor,
        onChainTxHash: onChain.txHash,
        executadoEm: new Date(),
        status: PagamentoStatus.EXECUTADO,
      },
      update: {
        valor,
        onChainTxHash: onChain.txHash,
        executadoEm: new Date(),
        status: PagamentoStatus.EXECUTADO,
      },
    });
    await tx.leadVendedor.update({
      where: { id: cessao.oferta.leadVendedorId },
      data: { status: LeadVendedorStatus.PIX_EXECUTADO },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'PIX_SIMULADO_EXECUTADO',
        operador: input.operador,
        leadVendedorId: cessao.oferta.leadVendedorId,
        cessaoId: cessao.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return created;
  });

  return { pagamentoId: pagamento.id, ...onChain };
}

// ─── 6. Incorporação ao pool (wrapper de tokenizacao.incorporarCota) ────────

export async function incorporarCotaDoFunil(input: {
  cessaoId: string;
  localizacaoAprox?: string;
  desagioRevenda?: string;
  operador: string;
}) {
  const cessao = await db.cessao.findUnique({
    where: { id: input.cessaoId },
    include: { oferta: true, pagamento: true, cota: true },
  });
  if (!cessao) throw new Error('Cessão não encontrada');
  if (cessao.pagamento?.status !== PagamentoStatus.EXECUTADO) {
    throw new Error('Pix precisa estar EXECUTADO antes de incorporar');
  }
  if (cessao.cota) throw new Error('Cota já incorporada pra esta cessão');

  // Re-usa tokenizacao.incorporarCota (já emite on-chain + audit COTA_INCORPORADA).
  const result = await incorporarCota({
    tipoBem: cessao.oferta.tipoBem,
    administradora: cessao.oferta.administradora,
    valorCarta: cessao.oferta.valorCarta.toString(),
    desagioAquisicao: cessao.oferta.desagioAquisicao.toString(),
    desagioRevenda: input.desagioRevenda,
    localizacaoAprox: input.localizacaoAprox,
    prazoRestanteMeses: cessao.oferta.prazoRestanteMeses ?? undefined,
    operador: input.operador,
    notas: `funil-vendedor:${cessao.oferta.leadVendedorId}`,
    cessaoId: cessao.id,
  });

  await db.$transaction(async (tx) => {
    await tx.cessao.update({
      where: { id: cessao.id },
      data: { status: CessaoStatus.ASSINADA }, // ja ta, mas re-assert
    });
    await tx.leadVendedor.update({
      where: { id: cessao.oferta.leadVendedorId },
      data: { status: LeadVendedorStatus.COTA_INCORPORADA },
    });
    // O audit COTA_INCORPORADA já foi feito por incorporarCota; aqui só ligamos.
    await tx.eventoAudit.updateMany({
      where: { cotaId: result.cotaId, acao: 'COTA_INCORPORADA' },
      data: {
        leadVendedorId: cessao.oferta.leadVendedorId,
        cessaoId: cessao.id,
      },
    });
  });

  return result;
}
