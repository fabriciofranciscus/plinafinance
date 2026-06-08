/**
 * Mapa de etapas do funil do cedente (PRD §M1 F-M1-5).
 *
 * Função pura usada pela página de acompanhamento (`/vender/acompanhar/[leadId]`)
 * e testável isoladamente.
 */

import { LeadVendedorStatus } from '@prisma/client';

export const ETAPAS_VENDER = [
  'Cadastro & KYC',
  'Envio da cota',
  'Validação jurídica',
  'Oferta de preço',
  'Cessão digital',
  'Pix recebido',
] as const;

// Na página de acompanhamento o lead JÁ existe, então as duas primeiras etapas
// do funil — 'Cadastro & KYC' (0) e 'Envio da cota' (1) — estão sempre
// concluídas. Por isso nenhum status mapeia para 0/1: um lead recém-enviado
// (NOVO) já está aguardando a 'Validação jurídica' (2). Um lead concluído
// aponta para `length` → todas as etapas aparecem com ✓.
const ETAPA_POR_STATUS: Record<LeadVendedorStatus, number> = {
  NOVO: 2,
  CONTATADO: 2,
  DOCS_SOLICITADOS: 2,
  DOCS_RECEBIDOS: 3,
  OFERTA_ENVIADA: 3,
  OFERTA_ACEITA: 4,
  CESSAO_ASSINADA: 5,
  PIX_EXECUTADO: ETAPAS_VENDER.length,
  COTA_INCORPORADA: ETAPAS_VENDER.length,
  PERDIDO: -1,
};

/**
 * Índice (0-based) da etapa atual no stepper de acompanhamento.
 * -1 quando o lead foi encerrado (PERDIDO); `ETAPAS_VENDER.length` quando o
 * fluxo está concluído (todas as etapas com ✓).
 */
export function etapaDoStatus(status: LeadVendedorStatus): number {
  return ETAPA_POR_STATUS[status] ?? 2;
}

export function isEncerrado(status: LeadVendedorStatus): boolean {
  return status === LeadVendedorStatus.PERDIDO;
}
