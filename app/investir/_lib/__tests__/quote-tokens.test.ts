import { describe, expect, it } from 'vitest';
import type { QuoteData } from '../../_types';
import { tokensDaCotacao } from '../quote-tokens';

const base: QuoteData = {
  quoteId: 'q-1',
  fromAmount: '10416.67',
  toAmount: '10416.67',
  exchangeRate: '1',
  fee: '0',
  expiresAt: '2026-11-10T20:00:00Z',
};

describe('tokensDaCotacao', () => {
  it('usa o plinarfAmount do servidor (NAV ≠ 1: tokens ≠ valor em TESOURO)', () => {
    expect(tokensDaCotacao({ ...base, plinarfAmount: '10000.0000000' })).toBe('10000.0000000');
  });

  it('cotação sem preço de emissão (antiga) cai para toAmount', () => {
    expect(tokensDaCotacao(base)).toBe('10416.67');
    expect(tokensDaCotacao({ ...base, plinarfAmount: null })).toBe('10416.67');
  });
});
