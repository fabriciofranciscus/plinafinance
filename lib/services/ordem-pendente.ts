/**
 * Retomada da compra (U2 A-02): a ordem do on-ramp que o investidor ainda não terminou.
 *
 * O estado da compra vive no navegador (cotação + ordem do on-ramp); recarregar o /investir o perde e o TESOURO já pago
 * fica parado na carteira. Esta função PURA diz, a partir do que o banco já guarda (OnRampOrder + Quote), em que passo a
 * compra parou. Só leitura: não existe caminho novo de dinheiro; quem retoma usa o mesmo build/assinatura/submit do swap,
 * e o servidor segue validando dono do quote, estado da ordem e conferência.
 */

export type FaseOrdemPendente =
  | 'aguardando_pagamento' // ordem criada, Pix ainda não confirmado → tela `onramp`
  | 'liquidando' // pago, o anchor ainda não entregou o TESOURO → tela `settling`
  | 'resgatar_tesouro' // TESOURO em claimable balance, falta o claim → tela `claiming`
  | 'concluir_swap' // TESOURO na carteira, falta o swap → build do swap (tela `confirm`)
  | 'em_conferencia'; // swap enviado, a Plina confere na rede: SEM ação do usuário

/** Ordens que não vão mais gerar TESOURO: nunca se oferece retomar. */
export const STATUS_ORDEM_ENCERRADA = ['failed', 'expired', 'cancelled', 'refunded'] as const;

export interface OrdemParaFase {
  status: string;
  stellarClaimableBalanceId: string | null;
  claimTxHash: string | null;
  quote: { submitXdrHash: string | null; consumedAt: Date | null };
}

/** `null` = nada a retomar (concluída, morta ou com status desconhecido: fail-closed, não se oferece). */
export function faseDaOrdem(o: OrdemParaFase): FaseOrdemPendente | null {
  if (o.quote.consumedAt) return null; // swap concluído
  if ((STATUS_ORDEM_ENCERRADA as readonly string[]).includes(o.status)) return null;
  // Swap já enviado e ainda não escriturado: a cotação nova é bloqueada no servidor; refazer seria dobrar a compra.
  if (o.quote.submitXdrHash) return 'em_conferencia';

  const temClaimable = !!o.stellarClaimableBalanceId;
  // Mesma regra do `goToConfirm` da tela: `completed`, ou `processing` já com o claimable balance emitido.
  const pronta = o.status === 'completed' || (o.status === 'processing' && temClaimable);
  if (pronta) return temClaimable && !o.claimTxHash ? 'resgatar_tesouro' : 'concluir_swap';
  if (o.status === 'processing') return 'liquidando';
  if (o.status === 'pending') return 'aguardando_pagamento';
  return null;
}

/**
 * U2 A-09: a ordem que o anchor não confirma. Depois do Pix pago a ordem fica `processing` até o anchor entregar o TESOURO
 * (claimable balance). No sandbox, 2 de 6 ordens ficaram nesse estado para sempre e a tela esperava sem limite nem saída.
 * Esta regra única diz quando a espera passou do normal (medido no sandbox: 30–100 s): `processing`, SEM claimable balance,
 * há mais de 180 s. `pending` (a pessoa ainda não pagou) nunca é atraso; com claimable balance a tela já segue para o claim.
 * O `atualizadoEm` marca desde quando está em `processing` porque a rota de status só grava quando o status MUDA. Só informa:
 * não cancela nem altera a ordem (cancelar é do anchor e da operação).
 */
export const LIMITE_CONFIRMACAO_ONRAMP_S = 180;

export interface OrdemParaAtraso {
  status: string;
  stellarClaimableBalanceId: string | null;
  atualizadoEm: Date;
}

export function onrampAtrasado(o: OrdemParaAtraso, agora: Date = new Date()): boolean {
  if (o.status !== 'processing' || o.stellarClaimableBalanceId) return false;
  return agora.getTime() - o.atualizadoEm.getTime() > LIMITE_CONFIRMACAO_ONRAMP_S * 1000;
}

/** Os campos aditivos que as rotas devolvem. `desde` só existe enquanto a ordem espera a confirmação do anchor. */
export function infoConfirmacao(o: OrdemParaAtraso, agora: Date = new Date()) {
  const esperando = o.status === 'processing' && !o.stellarClaimableBalanceId && o.atualizadoEm instanceof Date;
  return {
    desde: esperando ? o.atualizadoEm.toISOString() : null,
    atrasada: o.atualizadoEm instanceof Date ? onrampAtrasado(o, agora) : false,
    limiteSegundos: LIMITE_CONFIRMACAO_ONRAMP_S,
  };
}

