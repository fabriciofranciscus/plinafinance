import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIG_NETWORK = process.env.STELLAR_NETWORK;
const ORIG_FUNDER_SECRET = process.env.STELLAR_FUNDER_SECRET;
const ORIG_FUNDER_PUBLIC = process.env.STELLAR_FUNDER_PUBLIC;

afterEach(() => {
  if (ORIG_NETWORK !== undefined) process.env.STELLAR_NETWORK = ORIG_NETWORK;
  else delete process.env.STELLAR_NETWORK;
  if (ORIG_FUNDER_SECRET !== undefined)
    process.env.STELLAR_FUNDER_SECRET = ORIG_FUNDER_SECRET;
  else delete process.env.STELLAR_FUNDER_SECRET;
  if (ORIG_FUNDER_PUBLIC !== undefined)
    process.env.STELLAR_FUNDER_PUBLIC = ORIG_FUNDER_PUBLIC;
  else delete process.env.STELLAR_FUNDER_PUBLIC;
  vi.resetModules();
});

describe('fundAccountIfNeeded — F-08', () => {
  it('no-op se conta já existe (testnet)', async () => {
    process.env.STELLAR_NETWORK = 'TESTNET';
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    const spy = vi
      .spyOn(account.horizon, 'loadAccount')
      .mockResolvedValueOnce({} as Awaited<
        ReturnType<typeof account.horizon.loadAccount>
      >);
    const r = await account.fundAccountIfNeeded('Gxxxx');
    expect(r.funded).toBe(false);
    spy.mockRestore();
  });

  it('testnet: bate friendbot quando conta não existe', async () => {
    process.env.STELLAR_NETWORK = 'TESTNET';
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    const loadSpy = vi
      .spyOn(account.horizon, 'loadAccount')
      .mockRejectedValueOnce({ response: { status: 404 } });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );
    const r = await account.fundAccountIfNeeded('Gnew');
    expect(r.funded).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('friendbot.stellar.org'),
    );
    loadSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('mainnet sem funder configurado lança erro explícito', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    delete process.env.STELLAR_FUNDER_SECRET;
    delete process.env.STELLAR_FUNDER_PUBLIC;
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    vi.spyOn(account.horizon, 'loadAccount').mockRejectedValueOnce({
      response: { status: 404 },
    });
    await expect(account.fundAccountIfNeeded('Gnew')).rejects.toThrow(
      /STELLAR_FUNDER_SECRET\/PUBLIC ausentes/,
    );
  });

  it('createFundedAccount lança em mainnet (helper testnet-only)', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    await expect(account.createFundedAccount()).rejects.toThrow(
      /testnet-only/,
    );
  });
});
