import { describe, expect, it } from 'vitest';
import type { QuoteData } from '../../_types';
import { quoteComBuild, tokensDaCotacao } from '../quote-tokens';

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

describe('quoteComBuild — a confirmação mostra o preço do build', () => {
  const real = {
    xdr: 'x',
    hashHex: '0xab',
    quoteId: 'q-1',
    plinarfAmount: '9990.0000000',
    navPorTokenNaCotacao: '1.04274274',
    mock: false as const,
  };

  it('usa plinarfAmount e navPorTokenNaCotacao do build, não os do /quote inicial', () => {
    const inicial = { ...base, plinarfAmount: '10000.0000000', navPorTokenNaCotacao: '1.04170000' };
    const vigente = quoteComBuild(inicial, real);
    expect(vigente.plinarfAmount).toBe('9990.0000000');
    expect(vigente.navPorTokenNaCotacao).toBe('1.04274274');
    expect(tokensDaCotacao(vigente)).toBe('9990.0000000');
    // não altera o restante nem o objeto original
    expect(vigente.fromAmount).toBe(base.fromAmount);
    expect(inicial.plinarfAmount).toBe('10000.0000000');
  });

  it('sem build ou com mock, a cotação segue como veio', () => {
    const inicial = { ...base, plinarfAmount: '10000.0000000' };
    expect(quoteComBuild(inicial, null)).toBe(inicial);
    expect(quoteComBuild(inicial, { txHash: 't', mock: true, alreadyExecuted: true })).toBe(inicial);
  });
});
