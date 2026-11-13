import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { loadAccount } = vi.hoisted(() => ({ loadAccount: vi.fn() }));

vi.mock('@/lib/stellar/account', () => ({
  horizon: { loadAccount },
  getAssetBalance: vi.fn(),
}));

import {
  SupplyConfigError,
  fetchSaldoTesouraria,
  fetchSaldoTesourariaDasClasses,
} from '@/lib/stellar/supply';

/**
 * TES-1 (leitura): saldo real do distributor por code, só leitura. Contrato:
 * contratos/2026-11-09-saldo-tesouraria.md.
 */
const ISSUER = 'GISSUER';
const OUTRO_ISSUER = 'GOUTRO';
const DISTRIBUTOR = 'GDISTRIBUTOR';

function trustline(code: string, balance: string, issuer = ISSUER, autorizada = true) {
  return {
    asset_type: 'credit_alphanum12',
    asset_code: code,
    asset_issuer: issuer,
    balance,
    is_authorized: autorizada,
  };
}

beforeEach(() => {
  vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
  vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', DISTRIBUTOR);
  loadAccount.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchSaldoTesourariaDasClasses', () => {
  it('lê as duas classes numa leitura só da conta do distributor', async () => {
    loadAccount.mockResolvedValueOnce({
      balances: [
        { asset_type: 'native', balance: '50.0000000' },
        trustline('PLINARF', '2539554.3335618'),
        // Mesmo code de outro issuer não é da Plina.
        trustline('PLINARFB', '999.0000000', OUTRO_ISSUER),
      ],
    });

    const { senior, subordinada } = await fetchSaldoTesourariaDasClasses();

    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(loadAccount).toHaveBeenCalledWith(DISTRIBUTOR);
    expect(senior.code).toBe('PLINARF');
    expect(senior.issuer).toBe(ISSUER);
    expect(senior.distributor).toBe(DISTRIBUTOR);
    expect(senior.saldo.toFixed(7)).toBe('2539554.3335618');
    expect(senior.temTrustline).toBe(true);
    expect(senior.autorizada).toBe(true);
    expect(subordinada.code).toBe('PLINARFB');
    expect(subordinada.saldo.toFixed(7)).toBe('0.0000000');
    expect(subordinada.temTrustline).toBe(false);
    expect(subordinada.autorizada).toBe(false);
  });

  it('trustline desautorizada aparece como tal, com o saldo', async () => {
    loadAccount.mockResolvedValueOnce({
      balances: [trustline('PLINARFB', '10.0000000', ISSUER, false)],
    });

    const s = await fetchSaldoTesouraria('PLINARFB');

    expect(s.saldo.toFixed(7)).toBe('10.0000000');
    expect(s.temTrustline).toBe(true);
    expect(s.autorizada).toBe(false);
  });

  it('falha do Horizon propaga (fail-closed)', async () => {
    loadAccount.mockRejectedValueOnce(new Error('horizon 504'));
    await expect(fetchSaldoTesourariaDasClasses()).rejects.toThrow('horizon 504');
  });
});

describe('fetchSaldoTesouraria — recusas', () => {
  it('code fora da Plina, sem ir ao Horizon', async () => {
    const err = await fetchSaldoTesouraria('USDC').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplyConfigError);
    expect((err as SupplyConfigError).code).toBe('SUPPLY_ASSET_UNKNOWN');
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it('chaves ausentes: erro tipado sem nome de env', async () => {
    vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', '');
    const err = await fetchSaldoTesouraria('PLINARF').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplyConfigError);
    expect((err as SupplyConfigError).code).toBe('SUPPLY_CONFIG_MISSING');
    expect((err as Error).message).not.toMatch(/STELLAR_|_PUBLIC/);
    expect(loadAccount).not.toHaveBeenCalled();
  });
});
