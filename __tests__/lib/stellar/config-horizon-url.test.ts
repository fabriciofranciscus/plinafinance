import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * STELLAR_HORIZON_URL vazia (o .env.example trazia `STELLAR_HORIZON_URL=`) derrubava /pool, /cotas e /admin com 500,
 * porque `??` só cai no padrão com undefined (achado da Vera no quickstart; Atlas, 16/11).
 */
async function horizonUrlCom(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  return (await import('@/lib/stellar/config')).horizonUrl;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('horizonUrl', () => {
  it('vazia → padrão da testnet', async () => {
    expect(await horizonUrlCom({ STELLAR_NETWORK: 'TESTNET', STELLAR_HORIZON_URL: '' })).toBe('https://horizon-testnet.stellar.org');
  });

  it('só espaços → padrão da rede (PUBLIC)', async () => {
    expect(await horizonUrlCom({ STELLAR_NETWORK: 'PUBLIC', STELLAR_HORIZON_URL: '   ' })).toBe('https://horizon.stellar.org');
  });

  it('ausente → padrão da rede', async () => {
    expect(await horizonUrlCom({ STELLAR_NETWORK: 'TESTNET', STELLAR_HORIZON_URL: undefined })).toBe('https://horizon-testnet.stellar.org');
  });

  it('preenchida → usa a configurada (sem espaços nas pontas)', async () => {
    expect(await horizonUrlCom({ STELLAR_NETWORK: 'TESTNET', STELLAR_HORIZON_URL: ' https://horizon.exemplo.test ' })).toBe('https://horizon.exemplo.test');
  });
});
