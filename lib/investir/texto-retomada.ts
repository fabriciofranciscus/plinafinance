/**
 * Textos da retomada da compra (U2 A-02), FONTE ÚNICA do cartão do /investir e da "próxima ação" do /inicio (A-07): o mesmo
 * passo da mesma compra usa as mesmas palavras nas duas telas. Decididos pela Norma (16/11). Sem dependência de servidor nem
 * de React.
 */
import type { FaseOrdemPendente } from '../services/ordem-pendente';

/** Frase da Norma (16/11): em testnet o pagamento é SIMULADO; sem ela os textos de pagamento afirmariam um pagamento real. */
export const AVISO_PAGAMENTO_SIMULADO = 'Em rede de testes, o pagamento é simulado.';

/**
 * Textos por fase (U2 A-02), decididos pela Norma (16/11). Só dizem o que o sistema sabe: as fases de pagamento levam o aviso
 * de pagamento simulado; sem prazo vago em "conferência" (mesma regra do saque); o claim é "receber" (o glossário reserva
 * "resgate" à saída de tokens); "em conferência" não tem botão.
 */
export const TEXTO_RETOMADA: Record<FaseOrdemPendente, { titulo: string; texto: string; botao: string | null }> = {
  aguardando_pagamento: {
    titulo: 'Você tem uma compra aguardando o pagamento',
    texto: `Você iniciou uma compra e ainda não concluiu o pagamento. ${AVISO_PAGAMENTO_SIMULADO} Dá para continuar de onde parou.`,
    botao: 'Continuar compra',
  },
  liquidando: {
    titulo: 'Seu pagamento está sendo confirmado',
    texto: `Recebemos a sua ordem e falta a confirmação do pagamento. Dá para acompanhar de onde parou. ${AVISO_PAGAMENTO_SIMULADO}`,
    botao: 'Acompanhar compra',
  },
  resgatar_tesouro: {
    titulo: 'Falta receber o seu TESOURO',
    texto: `Seu pagamento foi confirmado e o TESOURO está reservado para você. Falta um passo para ele chegar à sua carteira. ${AVISO_PAGAMENTO_SIMULADO}`,
    botao: 'Receber TESOURO',
  },
  concluir_swap: {
    titulo: 'Você tem TESOURO na carteira: conclua a compra',
    texto: `Seu pagamento foi confirmado e o TESOURO já está com você. Falta trocá-lo para concluir a compra. ${AVISO_PAGAMENTO_SIMULADO}`,
    botao: 'Concluir compra',
  },
  em_conferencia: {
    titulo: 'Sua compra está em conferência',
    texto: 'Já enviamos a troca e estamos conferindo na rede. Não refaça a compra.',
    botao: null,
  },
};
