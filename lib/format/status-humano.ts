/**
 * Texto humano para status que antes apareciam crus na tela (A3, backlog de usabilidade de 25/11): "KYC NAO_INICIADO",
 * "○ not_started", "friendbot · agora". FONTE ÚNICA: a tela só lê daqui, então trocar um texto (Norma/Consuelo) é editar este
 * arquivo. Só exibição: nada aqui decide estado nem altera o que o servidor devolve.
 *
 * O nome mostrado ao usuário é "Verificação de identidade" (feminino, glossário U3, Consuelo): os estados concordam com ele e
 * "KYC" não aparece como rótulo. Não se mostra o motivo de uma recusa.
 */

const KYC: Record<string, string> = {
  // Pessoa.kycStatus (banco)
  NAO_INICIADO: 'não iniciada',
  PENDENTE: 'em andamento',
  // "aprovada" sem qualificador sugere aprovação real (Consuelo). Enquanto a verificação for simulada (rede de testes), o selo diz
  // "(simulada)"; este é o ÚNICO lugar a mudar no cutover para a rede principal.
  APROVADO: 'aprovada (simulada)',
  REJEITADO: 'não aprovada',
  // onboard.kycStatus (/investir)
  not_started: 'não iniciada',
  pending: 'em andamento',
  approved: 'aprovada (simulada)',
};

/** Rótulo do status de KYC. Valor ausente ou desconhecido nunca vai cru para a tela. */
export function rotuloKyc(status: string | null | undefined): string {
  return (status && KYC[status]) || 'sem informação';
}

/** Nome da linha e do selo, antes do status. */
export const ROTULO_VERIFICACAO = 'Verificação de identidade';

/** Selo curto ("● Verificação de identidade: aprovada"). `aprovado` vem do servidor; o status só descreve os demais. */
export function seloVerificacao(aprovado: boolean, status: string | null | undefined): string {
  return `${aprovado ? '●' : '○'} ${ROTULO_VERIFICACAO}: ${aprovado ? rotuloKyc('approved') : rotuloKyc(status)}`;
}

/** Linha de funding da conta de teste no /investir (antes: "Funding" / "friendbot · agora"). */
export const FUNDING_ROTULO = 'Saldo inicial';
export const FUNDING_TEXTO = 'XLM de teste da rede de testes, sem valor real, recebido na criação da conta.';
