import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Gate fail-closed do mock free-mint. `STELLAR_NETWORK` é const de module-load
 * em `lib/stellar/config.ts`, então cada combo precisa de `resetModules` +
 * import dinâmico pra reavaliar a rede.
 */
const ORIG_STELLAR = process.env.STELLAR_NETWORK;
const ORIG_ETHERFUSE = process.env.ETHERFUSE_ENV;

async function load(stellar: string | undefined, etherfuse: string | undefined) {
  vi.resetModules();
  if (stellar === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = stellar;
  if (etherfuse === undefined) delete process.env.ETHERFUSE_ENV;
  else process.env.ETHERFUSE_ENV = etherfuse;
  return import('@/lib/env/etherfuse');
}

afterEach(() => {
  if (ORIG_STELLAR === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = ORIG_STELLAR;
  if (ORIG_ETHERFUSE === undefined) delete process.env.ETHERFUSE_ENV;
  else process.env.ETHERFUSE_ENV = ORIG_ETHERFUSE;
});

describe('sandboxMockAllowed', () => {
  it('TESTNET + env ausente → true (default sandbox)', async () => {
    const { sandboxMockAllowed } = await load('TESTNET', undefined);
    expect(sandboxMockAllowed()).toBe(true);
  });

  it('TESTNET + production → false', async () => {
    const { sandboxMockAllowed } = await load('TESTNET', 'production');
    expect(sandboxMockAllowed()).toBe(false);
  });

  it('PUBLIC + env ausente → false (fail-closed na rede)', async () => {
    const { sandboxMockAllowed } = await load('PUBLIC', undefined);
    expect(sandboxMockAllowed()).toBe(false);
  });

  it('PUBLIC + sandbox → false (rede manda, não a env Etherfuse)', async () => {
    const { sandboxMockAllowed } = await load('PUBLIC', 'sandbox');
    expect(sandboxMockAllowed()).toBe(false);
  });

  it('PUBLIC + production → false (mock nunca em mainnet)', async () => {
    const { sandboxMockAllowed } = await load('PUBLIC', 'production');
    expect(sandboxMockAllowed()).toBe(false);
  });
});

describe('assertEtherfuseEnvConsistency', () => {
  it('TESTNET + ausente → não lança', async () => {
    const { assertEtherfuseEnvConsistency } = await load('TESTNET', undefined);
    expect(() => assertEtherfuseEnvConsistency()).not.toThrow();
  });

  it('TESTNET + production → não lança (Etherfuse real em testnet é válido)', async () => {
    const { assertEtherfuseEnvConsistency } = await load('TESTNET', 'production');
    expect(() => assertEtherfuseEnvConsistency()).not.toThrow();
  });

  it('PUBLIC + production → não lança', async () => {
    const { assertEtherfuseEnvConsistency } = await load('PUBLIC', 'production');
    expect(() => assertEtherfuseEnvConsistency()).not.toThrow();
  });

  it('PUBLIC + env ausente → lança (cutover esquecido)', async () => {
    const { assertEtherfuseEnvConsistency } = await load('PUBLIC', undefined);
    expect(() => assertEtherfuseEnvConsistency()).toThrow(/ETHERFUSE_ENV=production/);
  });

  it('PUBLIC + sandbox → lança', async () => {
    const { assertEtherfuseEnvConsistency } = await load('PUBLIC', 'sandbox');
    expect(() => assertEtherfuseEnvConsistency()).toThrow(/sem perna TESOURO/);
  });

  it('STELLAR_NETWORK inválido → lança', async () => {
    const { assertEtherfuseEnvConsistency } = await load('STAGING', 'sandbox');
    expect(() => assertEtherfuseEnvConsistency()).toThrow(/STELLAR_NETWORK inválido/);
  });

  it('ETHERFUSE_ENV inválido → lança', async () => {
    const { assertEtherfuseEnvConsistency } = await load('TESTNET', 'prod');
    expect(() => assertEtherfuseEnvConsistency()).toThrow(/ETHERFUSE_ENV inválido/);
  });
});
