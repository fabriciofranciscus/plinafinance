import { describe, it, expect, vi, beforeEach } from 'vitest';

const { assetsCall, forIssuer, forCode, assets, getAssetBalance } = vi.hoisted(
  () => {
    const assetsCall = vi.fn();
    const forIssuer = vi.fn(() => ({ call: assetsCall }));
    const forCode = vi.fn(() => ({ forIssuer }));
    const assets = vi.fn(() => ({ forCode }));
    return {
      assetsCall,
      forIssuer,
      forCode,
      assets,
      getAssetBalance: vi.fn(),
    };
  },
);

vi.mock('@/lib/stellar/account', () => ({
  horizon: { assets },
  getAssetBalance,
}));

import { fetchSupplyOnChain } from '@/lib/stellar/supply';

const ISSUER = 'GISSUER';
const DISTRIBUTOR = 'GDISTRIBUTOR';

/** Registro do `/assets` do Horizon, só com os campos que o módulo lê. */
function assetRecord(over: Partial<Record<string, unknown>> = {}) {
  return {
    asset_code: 'PLINARF',
    asset_issuer: ISSUER,
    balances: {
      authorized: '1000.0000000',
      authorized_to_maintain_liabilities: '0.0000000',
      unauthorized: '0.0000000',
    },
    accounts: {
      authorized: 3,
      authorized_to_maintain_liabilities: 0,
      unauthorized: 0,
    },
    claimable_balances_amount: '0.0000000',
    liquidity_pools_amount: '0.0000000',
    contracts_amount: '0.0000000',
    ...over,
  };
}

beforeEach(() => {
  assetsCall.mockReset();
  getAssetBalance.mockReset().mockResolvedValue('0');
});

describe('fetchSupplyOnChain', () => {
  it('soma todos os campos de saldo do Horizon no total emitido', async () => {
    assetsCall.mockResolvedValueOnce({
      records: [
        assetRecord({
          balances: {
            authorized: '700.0000000',
            authorized_to_maintain_liabilities: '50.0000000',
            unauthorized: '30.0000000',
          },
          claimable_balances_amount: '15.0000000',
          liquidity_pools_amount: '4.0000000',
          contracts_amount: '1.0000000',
        }),
      ],
    });

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });

    // 700 + 50 + 30 + 15 + 4 + 1
    expect(s.totalEmitido.toFixed(7)).toBe('800.0000000');
    expect(s.emTransito.toFixed(7)).toBe('20.0000000');
  });

  it('circulante desconta a tesouraria do distributor', async () => {
    assetsCall.mockResolvedValueOnce({ records: [assetRecord()] });
    getAssetBalance.mockResolvedValueOnce('400.0000000');

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });

    expect(s.totalEmitido.toFixed(7)).toBe('1000.0000000');
    expect(s.tesouraria.toFixed(7)).toBe('400.0000000');
    expect(s.circulante.toFixed(7)).toBe('600.0000000');
  });

  it('clampa o circulante em zero quando a tesouraria passa do total', async () => {
    // Duas chamadas ao Horizon não são atômicas: entre uma e outra o saldo do
    // distributor pode aparecer maior que o agregado do asset.
    assetsCall.mockResolvedValueOnce({ records: [assetRecord()] });
    getAssetBalance.mockResolvedValueOnce('1500.0000000');

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });

    expect(s.circulante.toFixed(7)).toBe('0.0000000');
  });

  it('sinaliza saldo congelado quando há trustline desautorizada', async () => {
    assetsCall.mockResolvedValueOnce({
      records: [
        assetRecord({
          balances: {
            authorized: '900.0000000',
            authorized_to_maintain_liabilities: '0.0000000',
            unauthorized: '100.0000000',
          },
          accounts: {
            authorized: 2,
            authorized_to_maintain_liabilities: 0,
            unauthorized: 1,
          },
        }),
      ],
    });

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });

    expect(s.temSaldoCongelado).toBe(true);
    expect(s.contas.naoAutorizadas).toBe(1);
    // Saldo congelado continua sendo passivo: entra no total.
    expect(s.totalEmitido.toFixed(7)).toBe('1000.0000000');
  });

  it('asset nunca emitido devolve zeros, não erro', async () => {
    assetsCall.mockResolvedValueOnce({ records: [] });

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });

    expect(s.totalEmitido.isZero()).toBe(true);
    expect(s.circulante.isZero()).toBe(true);
    expect(s.temSaldoCongelado).toBe(false);
  });

  it('propaga falha do Horizon — não cai pro estado da aplicação', async () => {
    assetsCall.mockRejectedValueOnce(new Error('horizon 504'));

    await expect(
      fetchSupplyOnChain({
        issuerPubkey: ISSUER,
        distributorPubkey: DISTRIBUTOR,
      }),
    ).rejects.toThrow('horizon 504');
  });

  it('consulta o Horizon pelo par code+issuer', async () => {
    assetsCall.mockResolvedValueOnce({ records: [assetRecord()] });

    await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
      code: 'PLINARFB',
    });

    expect(forCode).toHaveBeenCalledWith('PLINARFB');
    expect(forIssuer).toHaveBeenCalledWith(ISSUER);
  });
});
