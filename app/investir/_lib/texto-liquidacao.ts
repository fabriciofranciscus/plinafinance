/**
 * Textos da tela de liquidação (U2 A-09): a espera normal e a espera que passou do limite, conforme a Norma (16/11): sem prazo
 * na tela ("3 minutos" é prazo), sem "mais do que o normal" (compara com um prazo) e sem jargão. O texto anterior usava "settlement/anchor/indexing" e prometia um "indexing grace ... antes de marcar falha" que NÃO existe
 * no código: nada marca falha). Em testnet o pagamento é SIMULADO; as duas fases que falam de pagamento levam o aviso.
 */
export const AVISO_PAGAMENTO_SIMULADO_LIQUIDACAO = 'Em rede de testes, o pagamento é simulado.';

export const TEXTO_LIQUIDACAO = {
  espera: {
    titulo: 'Aguardando a confirmação do pagamento.',
    texto: `Ainda não chegou a confirmação. Esta página se atualiza sozinha. ${AVISO_PAGAMENTO_SIMULADO_LIQUIDACAO}`,
    rotuloTempo: 'Tempo de espera',
    botaoAguardando: 'Aguardando confirmação…',
  },
  atrasada: {
    titulo: 'A confirmação ainda não chegou.',
    texto: `O pagamento foi enviado e ainda não foi confirmado. A compra fica guardada e volta como cartão no /investir e no /inicio. ${AVISO_PAGAMENTO_SIMULADO_LIQUIDACAO}`,
    botaoAtualizar: 'Atualizar agora',
    botaoAtualizando: 'Atualizando…',
    voltar: 'Voltar ao início',
    equipe: 'Falar com a equipe',
  },
} as const;

export const EMAIL_EQUIPE = 'contato@plina.finance';

/** Número curto da ordem (só o final do id), para a pessoa citar à equipe sem expor o id inteiro. */
export const numeroCurtoDaOrdem = (orderId: string) => orderId.slice(-6).toUpperCase();

export function mailtoEquipe(orderId: string): string {
  const assunto = `Compra em confirmação (ordem #${numeroCurtoDaOrdem(orderId)})`;
  const corpo = `Olá, a confirmação do pagamento da minha compra (ordem #${numeroCurtoDaOrdem(orderId)}) passou do tempo esperado.`;
  return `mailto:${EMAIL_EQUIPE}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
