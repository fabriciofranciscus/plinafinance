import type { FaseOrdemPendente } from '../services/ordem-pendente';

/**
 * Contrato de GET /api/me/resumo e GET /api/me/historico (item 12, Bento):
 * contratos/2026-11-15-me-resumo-historico.md. Respostas diretas, sem envelope.
 * Valores monetários e de tokens chegam como string do servidor; a tela só os
 * formata, nunca calcula. Campos marcados "reservado" não vêm na v1.
 */

export type StatusSolicitacao =
  | 'NOVO'
  | 'CONTATADO'
  | 'DOCS_SOLICITADOS'
  | 'DOCS_RECEBIDOS'
  | 'OFERTA_ENVIADA'
  | 'OFERTA_ACEITA'
  | 'CESSAO_ASSINADA'
  | 'PIX_EXECUTADO'
  | 'COTA_INCORPORADA'
  | 'PERDIDO';

export interface SolicitacaoResumo {
  id: string;
  status: StatusSolicitacao;
  /** 0-based como em lib/vender/etapas (NOVO = 2). */
  etapa: number;
  tipoBem: string | null;
  valorCarta: string | null;
  valorLiquido: string | null;
  ofertaValidade: string | null;
  /** Distingue "preparando a cessão" de "aguardando sua assinatura". */
  cessaoStatus: string | null;
}

export interface OperacaoPendente {
  tipo: 'entrada' | 'saida';
  valor: string;
  situacao: 'em_conferencia' | 'aguardando_assinatura';
  /** Só nas entradas (compra): em que passo a compra parou (A-07). Aditivo; ausente = comportamento antigo. */
  fase?: FaseOrdemPendente;
  /** Rota onde a pessoa continua. */
  continuarEm: '/investir' | '/sacar';
}

export interface PosicaoResumo {
  tokens: string;
  navPorToken: string | null;
  valorPeloNav: string | null;
  navFonte: 'ledger' | 'soroban' | null;
  snapshotEm: string | null;
  snapshotTxHash: string | null;
  /** Ledger falhou ou gate fechado: a tela mostra "—", nunca 1 nem 0 no lugar. */
  navIndisponivel?: boolean;
}

export interface ResumoDaConta {
  nome: string | null;
  papeis: string[];
  /** null = não é investidor. */
  posicao?: PosicaoResumo | null;
  /** Só as ABERTAS (exceto PERDIDO e COTA_INCORPORADA), até 20. */
  solicitacoes: SolicitacaoResumo[];
  operacoesPendentes: OperacaoPendente[];
  /** A rota de destino da verificação é decisão da tela (proxima-acao.ts), não do servidor. */
  bloqueio?: { motivo: 'kyc_pendente' | 'conta_suspensa' } | null;
}

export type TipoEvento =
  | 'solicitacao_enviada'
  | 'proposta_recebida'
  | 'proposta_aceita'
  | 'cessao_assinada'
  | 'pix_enviado'
  | 'cota_incorporada'
  | 'solicitacao_encerrada' // reservado: não vem na v1 (PERDIDO não gera evento)
  | 'entrada_no_pool'
  | 'saida_do_pool';

export interface EventoHistorico {
  /** Identificador estável do item (para chave de lista). */
  id: string;
  tipo: TipoEvento;
  em: string;
  lado: 'vender' | 'investir';
  valorBrl: string | null;
  tokens: string | null;
  situacao: 'concluido' | 'em_andamento' | 'falhou';
  txHash: string | null;
  /** Id curto da solicitação, quando houver. */
  referencia: string | null;
  /** Link interno (acompanhamento ou comprovante). */
  link: string | null;
  simulado: boolean;
  /** Reservado: não vem na v1 (situacao é sempre 'concluido'). */
  motivo?: string | null;
}

export interface PaginaHistorico {
  itens: EventoHistorico[];
  proximoCursor: string | null;
}
