import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  SupplyConfigError,
  fetchSupplyDaClasse,
  fetchSupplyDasClasses,
  fetchSupplyDoAsset,
  fetchSupplyOnChain,
  fetchSupplyOnChainFromEnv,
} from '@/lib/stellar/supply';

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
      code: 'PLINARF',
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
      code: 'PLINARF',
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
      code: 'PLINARF',
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
      code: 'PLINARF',
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
      code: 'PLINARF',
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
        code: 'PLINARF',
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

  it('PLINARFB circulando: emitido, tesouraria e circulante do próprio asset', async () => {
    assetsCall.mockResolvedValueOnce({
      records: [
        assetRecord({
          asset_code: 'PLINARFB',
          balances: {
            authorized: '480.0000000',
            authorized_to_maintain_liabilities: '0.0000000',
            unauthorized: '0.0000000',
          },
          claimable_balances_amount: '20.0000000',
        }),
      ],
    });
    getAssetBalance.mockResolvedValueOnce('150.0000000');

    const s = await fetchSupplyOnChain({
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
      code: 'PLINARFB',
    });

    // A tesouraria tem que ser lida no MESMO asset, não no PLINARF.
    expect(getAssetBalance).toHaveBeenCalledWith(DISTRIBUTOR, 'PLINARFB', ISSUER);
    expect(s.code).toBe('PLINARFB');
    expect(s.totalEmitido.toFixed(7)).toBe('500.0000000');
    expect(s.tesouraria.toFixed(7)).toBe('150.0000000');
    expect(s.circulante.toFixed(7)).toBe('350.0000000');
  });

  it('recusa code vazio sem consultar o Horizon', async () => {
    await expect(
      fetchSupplyOnChain({
        issuerPubkey: ISSUER,
        distributorPubkey: DISTRIBUTOR,
        code: '',
      }),
    ).rejects.toBeInstanceOf(SupplyConfigError);
    expect(assetsCall).not.toHaveBeenCalled();
  });
});

/**
 * Horizon fake por asset code: cada code tem seu registro em `/assets` e seu
 * saldo no distributor. Assim um teste que mistura as classes falha se o
 * módulo ler o asset errado.
 */
function mockLedger(
  porCode: Record<string, { record?: ReturnType<typeof assetRecord>; tesouraria: string }>,
) {
  forCode.mockImplementation(((code: string) => ({
    forIssuer: () => ({
      call: () => {
        const entry = porCode[code];
        return Promise.resolve({ records: entry?.record ? [entry.record] : [] });
      },
    }),
  })) as never);
  getAssetBalance.mockImplementation(async (_pk: string, code: string) =>
    porCode[code]?.tesouraria ?? '0',
  );
}

describe('leitura por asset code com chaves do ambiente', () => {
  beforeEach(() => {
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
    vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', DISTRIBUTOR);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fetchSupplyDasClasses lê Sênior e Subordinada cada uma no seu asset', async () => {
    mockLedger({
      PLINARF: { record: assetRecord(), tesouraria: '400.0000000' },
      PLINARFB: {
        record: assetRecord({
          asset_code: 'PLINARFB',
          balances: {
            authorized: '300.0000000',
            authorized_to_maintain_liabilities: '0.0000000',
            unauthorized: '0.0000000',
          },
        }),
        tesouraria: '100.0000000',
      },
    });

    const { senior, subordinada } = await fetchSupplyDasClasses();

    expect(senior.code).toBe('PLINARF');
    expect(senior.totalEmitido.toFixed(7)).toBe('1000.0000000');
    expect(senior.circulante.toFixed(7)).toBe('600.0000000');
    expect(subordinada.code).toBe('PLINARFB');
    expect(subordinada.totalEmitido.toFixed(7)).toBe('300.0000000');
    expect(subordinada.tesouraria.toFixed(7)).toBe('100.0000000');
    expect(subordinada.circulante.toFixed(7)).toBe('200.0000000');
  });

  it('fetchSupplyDasClasses falha fechado se uma das classes não responde', async () => {
    mockLedger({ PLINARF: { record: assetRecord(), tesouraria: '0' } });
    getAssetBalance.mockImplementation(async (_pk: string, code: string) => {
      if (code === 'PLINARFB') throw new Error('horizon 504');
      return '0';
    });

    await expect(fetchSupplyDasClasses()).rejects.toThrow('horizon 504');
  });

  it('fetchSupplyDaClasse resolve o code pela classe (fonte única)', async () => {
    mockLedger({
      PLINARFB: { record: assetRecord({ asset_code: 'PLINARFB' }), tesouraria: '0' },
    });

    const s = await fetchSupplyDaClasse('SUBORDINADA');

    expect(forCode).toHaveBeenCalledWith('PLINARFB');
    expect(s.code).toBe('PLINARFB');
  });

  it('fetchSupplyDoAsset recusa code que não é da Plina sem ir ao Horizon', async () => {
    const err = await fetchSupplyDoAsset('USDC').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SupplyConfigError);
    expect((err as SupplyConfigError).code).toBe('SUPPLY_ASSET_UNKNOWN');
    expect(forCode).not.toHaveBeenCalled();
  });

  it('chaves ausentes: erro tipado e mensagem sem nome de variável de ambiente', async () => {
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', '');

    const err = await fetchSupplyDoAsset('PLINARF').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SupplyConfigError);
    expect((err as SupplyConfigError).code).toBe('SUPPLY_CONFIG_MISSING');
    const msg = (err as Error).message;
    expect(msg).not.toMatch(/STELLAR_|_PUBLIC|_SECRET|process\.env/);
    expect(forCode).not.toHaveBeenCalled();
  });

  it('fetchSupplyOnChainFromEnv (deprecated) mantém o erro sem nome de env', async () => {
    vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', '');

    const err = await fetchSupplyOnChainFromEnv().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SupplyConfigError);
    expect((err as Error).message).not.toMatch(/STELLAR_|_PUBLIC/);
  });
});
