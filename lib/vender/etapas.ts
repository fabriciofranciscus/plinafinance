/**
 * Mapa de etapas do funil do cedente (PRD §M1 F-M1-5).
 *
 * Função pura usada pela página de acompanhamento (`/vender/acompanhar/[leadId]`)
 * e testável isoladamente.
 */

import { LeadVendedorStatus } from '@prisma/client';
import { EM_REDE_DE_TESTES } from '../rede-de-testes';

export const ETAPAS_VENDER = [
  'Cadastro & KYC',
  'Envio da cota',
  'Validação jurídica',
  'Oferta de preço',
  'Cessão digital',
  'Pagamento recebido',
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
      'Sua cota entrou na fila da nossa mesa. Iniciamos a análise da cota e dos documentos. Avisamos por e-mail a cada avanço.',
  },
  CONTATADO: {
    titulo: 'Análise da cota em andamento',
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
      'Recebemos sua documentação e estamos finalizando a validação para gerar a proposta.',
  },
  OFERTA_ENVIADA: {
    titulo: 'Proposta enviada',
    descricao:
      'Sua proposta está disponível abaixo, válida até a data indicada. Para aceitar, use o botão Aceitar nesta página.',
  },
  OFERTA_ACEITA: {
    titulo: 'Proposta aceita',
    descricao:
      'Tudo certo com a proposta. Estamos preparando a cessão digital para assinatura.',
  },
  CESSAO_ASSINADA: {
    titulo: EM_REDE_DE_TESTES ? 'Cessão assinada (demonstração)' : 'Cessão assinada',
    descricao:
      'A cessão foi assinada e registrada on-chain. O pagamento do valor líquido é feito depois da cessão assinada. Não prometemos prazo.',
  },
  PIX_EXECUTADO: {
    titulo: EM_REDE_DE_TESTES ? 'Pagamento simulado enviado' : 'Pagamento enviado',
    descricao:
      'O Pix do valor líquido foi executado. Confira o comprovante e o registro on-chain abaixo.',
  },
  COTA_INCORPORADA: {
    titulo: EM_REDE_DE_TESTES ? 'Concluído (simulação na rede de testes)' : 'Concluído',
    descricao:
      EM_REDE_DE_TESTES
        ? 'Pagamento simulado recebido e cota incorporada ao pool (simulação na rede de testes).'
        : 'Pagamento recebido e cota incorporada ao pool. Obrigado por vender com a Plina.',
  },
  PERDIDO: {
    titulo: 'Solicitação encerrada',
    descricao:
      'Esta solicitação foi encerrada. Se acha que houve engano, fale com a equipe em contato@plina.finance informando o número do seu pedido.',
  },
};

export function contextoDoStatus(status: LeadVendedorStatus): ContextoEtapa {
  return CONTEXTO_POR_STATUS[status] ?? CONTEXTO_POR_STATUS.NOVO;
}
