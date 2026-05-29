import { describe, it, expect, vi, afterEach } from 'vitest';
import { warnIfBalanceBelowFloor } from '@/lib/stellar/account';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warnIfBalanceBelowFloor', () => {
  it('loga quando saldo nativo < piso', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfBalanceBelowFloor([{ asset_type: 'native', balance: '3' }], 5, 'issuer');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('silencioso quando saldo >= piso', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfBalanceBelowFloor(
      [{ asset_type: 'native', balance: '10' }],
      5,
      'distributor',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('no-op sem saldo nativo', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfBalanceBelowFloor(
      [{ asset_type: 'credit_alphanum4', balance: '0' }],
      5,
      'issuer',
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
