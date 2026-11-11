import { describe, expect, it, vi } from 'vitest';
import { obterPrecoLiquidoTesouroBrl } from '@/lib/anchors/etherfuse/preco-tesouro';

const anchorCom = (q: Record<string, unknown>) => ({ getQuote: vi.fn().mockResolvedValue(q) });
const entrada = { customerId: 'cust_1', stellarAddress: 'GABC' };

describe('obterPrecoLiquidoTesouroBrl', () => {
  it('pede BRL→TESOURO e devolve (fromAmount − fee) ÷ toAmount, o preço líquido da subscrição', async () => {
    const anchor = anchorCom({ fromAmount: '100', fee: '0.5', toAmount: '85.5', exchangeRate: '0.855' });
    const preco = await obterPrecoLiquidoTesouroBrl({ ...entrada, anchor: anchor as never });
    expect(anchor.getQuote).toHaveBeenCalledWith(expect.objectContaining({ fromCurrency: 'BRL', toCurrency: 'TESOURO', customerId: 'cust_1', stellarAddress: 'GABC' }));
    expect(Number(preco)).toBeCloseTo(99.5 / 85.5, 10); // NÃO usa a exchangeRate bruta (fee fora)
  });

  it('cotação sem preço válido (toAmount 0, fee absurdo) → erro, sem inventar preço', async () => {
    for (const q of [
      { fromAmount: '100', fee: '0', toAmount: '0' },
      { fromAmount: '100', fee: '100', toAmount: '85' },
      { fromAmount: 'x', fee: '0', toAmount: '85' },
    ]) {
      await expect(obterPrecoLiquidoTesouroBrl({ ...entrada, anchor: anchorCom(q) as never })).rejects.toThrow(/preço válido/);
    }
  });

  it('sem ETHERFUSE_API_KEY e sem âncora injetada → erro (fail-closed)', async () => {
    const antes = process.env.ETHERFUSE_API_KEY;
    delete process.env.ETHERFUSE_API_KEY;
    await expect(obterPrecoLiquidoTesouroBrl(entrada)).rejects.toThrow(/ETHERFUSE_API_KEY/);
    if (antes) process.env.ETHERFUSE_API_KEY = antes;
  });
});
