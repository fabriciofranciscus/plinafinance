/**
 * Vocabulário das telas /inicio e /historico (spec de UX da Íris, §2.4 e §3.1).
 * ⚑C: os rótulos são PROPOSTA até o vocabulário final da Consuelo (item 11);
 * trocar só aqui. Usar "proposta", nunca "oferta firme".
 */

import type { StatusSolicitacao, TipoEvento } from './tipos';

/** Nome da etapa do cedente, por índice 0-based (lib/vender/etapas: NOVO = 2). */
export const NOME_ETAPA: Record<number, string> = {
  2: 'Análise da cota',
  3: 'Proposta de preço',
  4: 'Cessão digital',
  5: 'Pagamento',
};

export const TOTAL_ETAPAS = 6;

export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  solicitacao_enviada: 'Solicitação enviada',
  proposta_recebida: 'Proposta recebida',
  proposta_aceita: 'Proposta aceita',
  cessao_assinada: 'Cessão assinada',
  pix_enviado: 'Pagamento enviado',
  cota_incorporada: 'Cota incorporada ao pool',
  solicitacao_encerrada: 'Solicitação encerrada',
  entrada_no_pool: 'Entrada no pool',
  saida_do_pool: 'Saída do pool',
};

export const ROTULO_SITUACAO = {
  concluido: 'Concluído',
  em_andamento: 'Em andamento',
  falhou: 'Falhou',
} as const;

/** Status em que a solicitação ainda anda (não concluída nem encerrada). */
export const STATUS_ABERTOS: readonly StatusSolicitacao[] = [
  'NOVO',
  'CONTATADO',
  'DOCS_SOLICITADOS',
  'DOCS_RECEBIDOS',
  'OFERTA_ENVIADA',
  'OFERTA_ACEITA',
  'CESSAO_ASSINADA',
  'PIX_EXECUTADO',
];

export const ROTULO_TIPO_BEM: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviço',
};

/** Sufixos de rede de testes (Consuelo, item 11): evento simulado nunca aparece como real. */
export const SUFIXO_SIMULADO = {
  pagamento: 'Pagamento simulado enviado',
  cessao: ' (demonstração)',
  concluido: 'Concluído (simulação na rede de testes)',
} as const;
