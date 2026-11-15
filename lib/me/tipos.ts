/**
 * Contrato PROVISÓRIO de GET /api/me/resumo e GET /api/me/historico (spec de UX
 * da Íris, §7). O Bento ainda não publicou o contrato (item 12): quando sair em
 * contratos/, ajustar só este arquivo. Valores monetários e de tokens chegam
 * como string do servidor; a tela só os formata, nunca calcula.
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
  situacao: string;
  /** Rota onde a pessoa continua (/investir ou /sacar). */
  continuarEm: string;
}

export interface PosicaoResumo {
  tokens: string;
  navPorToken: string | null;
  valorPeloNav: string | null;
  navFonte: string | null;
  snapshotEm: string | null;
  snapshotTxHash: string | null;
  /** Ledger falhou: a tela mostra "—", nunca 1 nem 0 no lugar. */
  navIndisponivel?: boolean;
}

export interface ResumoDaConta {
  nome: string | null;
  papeis: string[];
  /** Ausente para quem não é investidor. */
  posicao?: PosicaoResumo | null;
  solicitacoes: SolicitacaoResumo[];
  operacoesPendentes: OperacaoPendente[];
  /** Pendência de verificação de identidade, se o resumo trouxer. */
  bloqueio?: { motivo: 'kyc_pendente' | 'conta_suspensa'; destino?: string } | null;
}

export type TipoEvento =
  | 'solicitacao_enviada'
  | 'proposta_recebida'
  | 'proposta_aceita'
  | 'cessao_assinada'
  | 'pix_enviado'
  | 'cota_incorporada'
  | 'solicitacao_encerrada'
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
  /** Motivo do "falhou" em linguagem comum, quando existir. */
  motivo?: string | null;
}

export interface PaginaHistorico {
  itens: EventoHistorico[];
  proximoCursor: string | null;
}
