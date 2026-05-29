import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('mainnetCutoverGuard', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EDGE_CONFIG;
    delete process.env.MAINNET_ENABLED;
  });

  it('testnet → liberado (null)', async () => {
    delete process.env.STELLAR_NETWORK;
    const { mainnetCutoverGuard } = await import('@/lib/env/feature-gates');
    expect(await mainnetCutoverGuard()).toBeNull();
  });

  it('PUBLIC + MAINNET_ENABLED off → 503', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    process.env.MAINNET_ENABLED = 'false';
    const { mainnetCutoverGuard } = await import('@/lib/env/feature-gates');
    const res = await mainnetCutoverGuard();
    expect(res?.status).toBe(503);
  });

  it('PUBLIC + MAINNET_ENABLED on → liberado (null)', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    process.env.MAINNET_ENABLED = 'true';
    const { mainnetCutoverGuard } = await import('@/lib/env/feature-gates');
    expect(await mainnetCutoverGuard()).toBeNull();
  });
});
