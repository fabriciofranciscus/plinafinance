/**
 * Formatadores e mapas de label compartilhados pelo painel.
 *
 * Extraídos de minha-posicao (absorvida pelo /painel): números pt-BR, rótulos
 * de ação de auditoria, tipo de bem e helpers de explorer (testnet).
 */

export const NUMBER_BR = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 4,
});
export const NUMBER_INT = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
});
export const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const TIPO_BEM_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviço',
};

export const ACAO_LABEL: Record<string, string> = {
  COTA_INCORPORADA: 'Cota incorporada ao pool',
  TOKEN_EMITIDO: 'PLINA-RF emitido',
  INVESTIDOR_ONBOARDED: 'Onboarding institucional concluído',
  TRUSTLINE_AUTORIZADA: 'Trustline autorizada pelo issuer',
  TRUSTLINE_REVOGADA: 'Trustline revogada',
  DISTRIBUICAO: 'Aquisição de PLINA-RF',
  CLAWBACK_EXECUTADO: 'Clawback institucional',
  COTA_REALIZADA: 'Cota realizada',
  PLINARF_LIQUIDADO: 'Liquidação de PLINA-RF',
};

export const MOTIVO_LABEL: Record<string, string> = {
  DECISAO_JUDICIAL: 'Decisão judicial',
  SANCAO_REGULATORIA: 'Sanção regulatória',
  FRAUDE_DOCUMENTAL: 'Fraude documental',
  ERRO_OPERACIONAL: 'Erro operacional',
};

const EXPLORER = 'https://stellar.expert/explorer/testnet';

export function explorerAccount(pubkey: string) {
  return `${EXPLORER}/account/${pubkey}`;
}
export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}
export function explorerAsset(code: string, issuer: string) {
  return `${EXPLORER}/asset/${code}-${issuer}`;
}

/** Abrevia uma pubkey Stellar pro formato GBQ7…W4XZ. */
export function abbreviate(pubkey: string): string {
  if (pubkey.length < 12) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}
