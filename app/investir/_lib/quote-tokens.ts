import type { QuoteData, SwapBuild } from '../_types';

/**
 * Quantidade de tokens que a tela mostra como "a receber".
 *
 * N1: a emissão é pelo NAV, então a quantidade é `plinarfAmount`, que o
 * servidor calcula e devolve no `/quote`; `toAmount` é o valor em TESOURO.
 * O cliente só exibe: não calcula. Cotação antiga (sem preço de emissão, POC
 * 1:1) cai para `toAmount`, como antes.
 */
/**
 * Cotação como a confirmação e o recibo a mostram: depois do build valem os
 * valores renovados do envelope (`plinarfAmount`, `navPorTokenNaCotacao`), não
 * os do /quote inicial. Sem build real (ou mock), a cotação segue como veio.
 */
export function quoteComBuild(quote: QuoteData, build: SwapBuild | null): QuoteData {
  if (!build || build.mock) return quote;
  return {
    ...quote,
    plinarfAmount: build.plinarfAmount,
    navPorTokenNaCotacao: build.navPorTokenNaCotacao,
  };
}

export function tokensDaCotacao(quote: QuoteData): string {
  return quote.plinarfAmount ?? quote.toAmount;
}
