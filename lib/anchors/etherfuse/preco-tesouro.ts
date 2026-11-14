/**
 * Preço LÍQUIDO do TESOURO em BRL pela cotação Etherfuse BRL→TESOURO (E2-6; Consuelo/Atlas): a mesma fonte e a mesma
 * base da subscrição — `(fromAmount − fee) ÷ toAmount`. O resgate paga ao NAV, sem fee nem deságio da Plina; o fee
 * da Etherfuse só entra aqui para o preço ficar simétrico à entrada. As rotas chamam; os serviços recebem o número
 * (serviço nunca importa o SDK da fornecedora).
 */

import { EtherfuseClient } from './index';
import { precoLiquidoDoTesouro } from '../../services/regras-resgate';

/** BRL de referência para ler o preço (só fonte de preço). */
const BRL_REFERENCIA = '100.00';

export async function obterPrecoLiquidoTesouroBrl(input: {
  customerId: string;
  stellarAddress: string;
  anchor?: Pick<EtherfuseClient, 'getQuote'>;
}): Promise<string> {
  let anchor = input.anchor;
  if (!anchor) {
    const apiKey = process.env.ETHERFUSE_API_KEY;
    if (!apiKey) throw new Error('ETHERFUSE_API_KEY ausente');
    anchor = new EtherfuseClient({
      apiKey,
      baseUrl: process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
    });
  }
  const q = await anchor.getQuote({
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: BRL_REFERENCIA,
    customerId: input.customerId,
    stellarAddress: input.stellarAddress,
  });
  const preco = precoLiquidoDoTesouro({ fromAmount: String(q.fromAmount), fee: q.fee, toAmount: String(q.toAmount) });
  if (!preco) throw new Error('cotação Etherfuse sem preço válido');
  return preco.toString();
}
