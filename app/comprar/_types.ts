/**
 * Tipos do wizard /comprar (fluxo oficial do mockup, 5 passos). Espelha
 * `app/investir/_types.ts`. `FlowError` é estruturalmente idêntico ao de
 * /investir — compatível com `ErrorBlock`/`asFlowError` reusados de lá.
 */

export type Screen =
  | 'buscar'
  | 'diligencia'
  | 'proposta'
  | 'kyc'
  | 'cessao'
  | 'confirmacao';

export interface FlowError {
  message: string;
  technical: string;
  ticketId: string;
}

/** Cota da listagem (passo 1). Administradora NÃO exposta. */
export interface CotaResumo {
  id: string;
  tipoBem: string;
  valorCarta: number;
  desagioRevenda: number | null;
  localizacaoAprox: string | null;
  prazoRestanteMeses: number | null;
  statusEstoque: string;
}

export interface DiligenciaEvento {
  acao: string;
  payloadHash: string | null;
  stellarTxHash: string | null;
  criadoEm: string;
}

export interface DiligenciaCota {
  id: string;
  tipoBem: string;
  valorCarta: number;
  desagioRevenda: number | null;
  localizacaoAprox: string | null;
  prazoRestanteMeses: number | null;
  status: string;
  statusEstoque: string;
  tokensEmitidos: number;
  emissaoTxHash: string | null;
  hashValidacao: string | null;
  validacaoTxHash: string | null;
  hashCessao: string | null;
}

export interface DiligenciaData {
  cota: DiligenciaCota;
  eventos: DiligenciaEvento[];
}

export interface ReservaData {
  reservaId: string;
  expiraEm: string;
  txHash: string;
  payloadHash: string;
}

export interface CessaoData {
  cessaoCompradorId: string;
  hashDocumento: string;
  txHash: string;
  reused: boolean;
}

export interface ConfirmacaoData {
  status: 'REALIZADA' | 'PENDENTE_CONFIRMACAO';
  realizacaoId?: string;
  spread?: string;
  valorRealizado: string;
  txHash?: string;
}
