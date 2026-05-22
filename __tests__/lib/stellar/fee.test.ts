import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeStats } = vi.hoisted(() => ({ feeStats: vi.fn() }));

vi.mock('@/lib/stellar/account', () => ({
  horizon: { feeStats },
}));

import { getDynamicFee, _resetFeeCacheForTests } from '@/lib/stellar/fee';

beforeEach(() => {
  feeStats.mockReset();
  _resetFeeCacheForTests();
  // Silenciar logStellarError no fallback test
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getDynamicFee — F-15', () => {
  it('retorna p70 quando feeStats responde', async () => {
    feeStats.mockResolvedValueOnce({ fee_charged: { p70: '500' } });
    expect(await getDynamicFee()).toBe('500');
  });

  it('aplica cap em 100_000 stroops', async () => {
    feeStats.mockResolvedValueOnce({ fee_charged: { p70: '999999' } });
    expect(Number(await getDynamicFee())).toBe(100_000);
  });

  it('aplica floor em BASE_FEE (100)', async () => {
    feeStats.mockResolvedValueOnce({ fee_charged: { p70: '10' } });
    expect(Number(await getDynamicFee())).toBeGreaterThanOrEqual(100);
  });

  it('fallback BASE_FEE em erro de Horizon', async () => {
    feeStats.mockRejectedValueOnce(new Error('horizon down'));
    expect(await getDynamicFee()).toBe('100');
  });

  it('reusa cache dentro da janela de 5s', async () => {
    feeStats.mockResolvedValueOnce({ fee_charged: { p70: '500' } });
    await getDynamicFee();
    await getDynamicFee();
    await getDynamicFee();
    expect(feeStats).toHaveBeenCalledTimes(1);
  });
});
