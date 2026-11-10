import type { QuoteData } from '../_types';

/**
 * Quantidade de tokens que a tela mostra como "a receber".
 *
 * N1: a emissão é pelo NAV, então a quantidade é `plinarfAmount`, que o
 * servidor calcula e devolve no `/quote`; `toAmount` é o valor em TESOURO.
 * O cliente só exibe: não calcula. Cotação antiga (sem preço de emissão, POC
 * 1:1) cai para `toAmount`, como antes.
 */
export function tokensDaCotacao(quote: QuoteData): string {
  return quote.plinarfAmount ?? quote.toAmount;
}
