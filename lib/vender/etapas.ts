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

/** Concluído com sucesso (Pix executado / cota incorporada). */
export function isConcluido(status: LeadVendedorStatus): boolean {
  return (
    status === LeadVendedorStatus.PIX_EXECUTADO ||
    status === LeadVendedorStatus.COTA_INCORPORADA
  );
}

export interface ContextoEtapa {
  titulo: string;
  descricao: string;
}

/**
 * Texto contextual da etapa atual — garante que toda etapa do acompanhamento
 * mostre algo, mesmo antes de existir oferta (NOVO/CONTATADO/DOCS_*). Evita a
 * tela "em branco" quando o lead ainda está em validação jurídica.
 */
const CONTEXTO_POR_STATUS: Record<LeadVendedorStatus, ContextoEtapa> = {
  NOVO: {
    titulo: 'Recebemos sua solicitação',
    descricao:
      'Sua cota entrou na fila da nossa mesa. Em breve iniciamos a validação jurídica e documental — você é avisado por e-mail a cada avanço.',
  },
  CONTATADO: {
    titulo: 'Validação jurídica em andamento',
    descricao:
      'Nossa mesa está conferindo a titularidade e a situação da sua cota junto à administradora.',
  },
  DOCS_SOLICITADOS: {
    titulo: 'Documentos solicitados',
    descricao:
      'Enviamos por e-mail a lista de documentos necessários. Responda àquele e-mail com os arquivos para seguirmos com a validação.',
  },
  DOCS_RECEBIDOS: {
    titulo: 'Documentos recebidos',
    descricao:
      'Recebemos sua documentação e estamos finalizando a validação para gerar a oferta firme.',
  },
  OFERTA_ENVIADA: {
    titulo: 'Oferta firme enviada',
    descricao:
      'Sua oferta está disponível abaixo, válida até a data indicada. Para aceitar, responda o e-mail recebido.',
  },
  OFERTA_ACEITA: {
    titulo: 'Oferta aceita',
    descricao:
      'Tudo certo com a oferta. Estamos preparando a cessão digital para assinatura.',
  },
  CESSAO_ASSINADA: {
    titulo: 'Cessão assinada',
    descricao:
      'A cessão foi assinada e registrada on-chain. O Pix do valor líquido é executado em até 48h.',
  },
  PIX_EXECUTADO: {
    titulo: 'Pix enviado',
    descricao:
      'O Pix do valor líquido foi executado. Confira o comprovante e o registro on-chain abaixo.',
  },
  COTA_INCORPORADA: {
    titulo: 'Concluído',
    descricao:
      'Pix recebido e cota incorporada ao pool tokenizado. Obrigado por vender com a Plina.',
  },
  PERDIDO: {
    titulo: 'Solicitação encerrada',
    descricao:
      'Esta solicitação foi encerrada. Se acha que houve engano, responda o último e-mail recebido da equipe Plina.',
  },
};

export function contextoDoStatus(status: LeadVendedorStatus): ContextoEtapa {
  return CONTEXTO_POR_STATUS[status] ?? CONTEXTO_POR_STATUS.NOVO;
}
