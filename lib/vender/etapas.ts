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

const ETAPA_POR_STATUS: Record<LeadVendedorStatus, number> = {
  NOVO: 0,
  CONTATADO: 1,
  DOCS_SOLICITADOS: 1,
  DOCS_RECEBIDOS: 2,
  OFERTA_ENVIADA: 3,
  OFERTA_ACEITA: 3,
  CESSAO_ASSINADA: 4,
  PIX_EXECUTADO: 5,
  COTA_INCORPORADA: 5,
  PERDIDO: -1,
};

/** Índice (0-based) da etapa atual; -1 quando o lead foi encerrado (PERDIDO). */
export function etapaDoStatus(status: LeadVendedorStatus): number {
  return ETAPA_POR_STATUS[status] ?? 0;
}

export function isEncerrado(status: LeadVendedorStatus): boolean {
  return status === LeadVendedorStatus.PERDIDO;
}
