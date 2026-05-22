import { describe, it, expect } from 'vitest';
import { STELLAR_TX_TIMEOUT_SEC } from '@/lib/stellar/config';

describe('STELLAR_TX_TIMEOUT_SEC — F-14', () => {
  it('está em [60, 120] segundos pra limitar janela de replay', () => {
    expect(STELLAR_TX_TIMEOUT_SEC).toBeGreaterThanOrEqual(60);
    expect(STELLAR_TX_TIMEOUT_SEC).toBeLessThanOrEqual(120);
  });
});
