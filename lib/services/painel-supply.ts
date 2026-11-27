/**
 * Leitura do supply on-chain para o painel /admin (M17 do backlog de usabilidade, 25/11). Antes: `.catch(() => null)` na página,
 * o campo ficava "—" sem log e sem explicação. Aqui a falha NUNCA lança (o painel continua abrindo), é REGISTRADA só com a classe
 * do erro (`causaSegura`: nunca a mensagem, que pode ter URL, chave ou dado de terceiros) e devolve `indisponivel` para a tela
 * dizer por que o campo está vazio. O leitor em si (`lib/stellar/supply.ts`) é da Estela e não muda.
 */
import { causaSegura } from '@/lib/api/causa-segura';
import { fetchSupplyOnChainFromEnv, type SupplyOnChain } from '@/lib/stellar/supply';

export type SupplyDoPainel =
  | { indisponivel: false; supply: SupplyOnChain }
  | { indisponivel: true; supply: null; motivo: 'LEITURA_FALHOU' };

export async function lerSupplyParaPainel(
  ler: () => Promise<SupplyOnChain> = () => fetchSupplyOnChainFromEnv(),
): Promise<SupplyDoPainel> {
  try {
    return { indisponivel: false, supply: await ler() };
  } catch (err) {
    console.error('[admin/supply] leitura do supply on-chain falhou', causaSegura(err));
    return { indisponivel: true, supply: null, motivo: 'LEITURA_FALHOU' };
  }
}
