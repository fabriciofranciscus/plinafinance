/**
 * Testes de Stellar não podem falar com o Horizon real: `getDynamicFee`
 * (lib/stellar/fee.ts) chama `horizon.feeStats()` ao montar qualquer tx, e sem
 * mock isso vira uma chamada de rede de verdade. Sob carga ela estoura o timeout
 * de 30 s (teste intermitente) e, sem rede, cai em BASE_FEE e mascara o fee.
 *
 * Recebe o objeto `horizon` que o código sob teste usa (nos testes que fazem
 * `vi.resetModules()` é o da importação dinâmica, não o de um import estático).
 * Com `restoreMocks: true` no vitest.config, chamar a cada teste (beforeEach).
 */
import { vi } from 'vitest';

export function mockFeeStats(
  horizon: { feeStats: (...args: never[]) => unknown },
  p70 = '100',
) {
  return vi
    .spyOn(horizon as { feeStats: () => Promise<unknown> }, 'feeStats')
    .mockResolvedValue({ fee_charged: { p70 } });
}
