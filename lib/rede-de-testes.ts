/**
 * O app opera só em rede de testes nesta fase: os textos de estado ao usuário levam o qualificador
 * "simulado/demonstração" (decisão da Consuelo, vocabulário do item 11). Fixo de propósito: o env
 * STELLAR_NETWORK não é público e importar lib/stellar/config no client puxaria o SDK pro bundle
 * (mesma razão do WizardHeader). Ao ir para a rede pública, virar `false` junto com a regra `redePublica`.
 */
export const EM_REDE_DE_TESTES = true;
