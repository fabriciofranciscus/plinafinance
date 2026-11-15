/**
 * Texto do consentimento LGPD do cedente: a ÚNICA FONTE, sem dependência de servidor (nada de `node:crypto`), para o
 * navegador poder importá-lo (o checkbox do /vender renderiza ESTA constante). A versão (hash) e o pseudônimo ficam em
 * `consentimento.ts`, que reexporta estas duas constantes.
 *
 * ⚠ O TEXTO ABAIXO É PROVISÓRIO (descreve o tratamento como o sistema o faz hoje, não é texto jurídico aprovado). Enquanto
 * `TEXTO_CONSENTIMENTO_APROVADO` for false a captura é RECUSADA na mainnet (fail-closed) e a tela não deve exibi-lo.
 * Norma/Consuelo entregam o texto aprovado; quem o troca aqui põe a flag em true NO MESMO commit.
 */

export const TEXTO_CONSENTIMENTO_LGPD =
  'Autorizo a Plina Finance a tratar meus dados de identificação e de contato para analisar a minha solicitação de venda de cota ' +
  'de consórcio. Autorizo também o registro, em rede pública (Stellar), apenas de um código (hash) que comprova este ' +
  'consentimento, sem meus dados pessoais. Posso revogar o consentimento a qualquer momento.';

/** `true` só depois de Norma/Consuelo aprovarem o texto acima. */
export const TEXTO_CONSENTIMENTO_APROVADO = false;
