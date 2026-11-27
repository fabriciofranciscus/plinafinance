/**
 * Rótulo do pagamento ao cedente por Pix para a tela do /admin (Norma ✓, 25/11). `TransferenciaPix.status` é o enum
 * `StatusTransferenciaPix` (5 valores); antes a tela imprimia o valor cru ("PROCESSANDO"). Sem "Pix" no rótulo, e INCERTO nunca diz
 * que falhou (a resposta ambígua do PSP não prova falha). Ausente ou desconhecido não vai cru.
 */
const ROTULO: Record<string, string> = {
  ENVIANDO: 'Pagamento sendo enviado',
  PROCESSANDO: 'Pagamento em processamento',
  INCERTO: 'Pagamento sem confirmação',
  FALHOU: 'Pagamento não concluído',
  COMPROVADA: 'Pagamento comprovado',
};

export function rotuloPagamentoPix(status: string | null | undefined): string {
  return (status && ROTULO[status]) || 'Pagamento sem informação';
}
