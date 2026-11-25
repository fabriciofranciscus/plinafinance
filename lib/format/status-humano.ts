/**
 * Texto humano para status que antes apareciam crus na tela (A3, backlog de usabilidade de 25/11): "KYC NAO_INICIADO",
 * "○ not_started", "friendbot · agora". FONTE ÚNICA: a tela só lê daqui, então trocar um texto (Norma/Consuelo) é editar este
 * arquivo. Só exibição: nada aqui decide estado nem altera o que o servidor devolve.
 *
 * Os estados concordam com "KYC" (palavra já usada nas telas), sem criar vocabulário novo.
 */

const KYC: Record<string, string> = {
  // Pessoa.kycStatus (banco)
  NAO_INICIADO: 'não iniciado',
  PENDENTE: 'em andamento',
  APROVADO: 'aprovado',
  REJEITADO: 'não aprovado',
  // onboard.kycStatus (/investir)
  not_started: 'não iniciado',
  pending: 'em andamento',
  approved: 'aprovado',
};

/** Rótulo do status de KYC. Valor ausente ou desconhecido nunca vai cru para a tela. */
export function rotuloKyc(status: string | null | undefined): string {
  return (status && KYC[status]) || 'sem informação';
}

/** Linha de funding da conta de teste no /investir (antes: "Funding" / "friendbot · agora"). */
export const FUNDING_ROTULO = 'Saldo inicial';
export const FUNDING_TEXTO = 'XLM de teste recebido agora';
