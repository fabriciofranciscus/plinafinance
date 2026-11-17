import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * E2 do checklist de cutover (Estela, 16/11): a rede tem de ser explícita e válida no boot. Vazia, só espaços ou
 * desconhecida → o boot recusa (assertEtherfuseEnvConsistency, chamado no instrumentation.ts). Ausente → TESTNET
 * (fail-safe: a passphrase de testnet não assina nada válido na mainnet). Valor com espaços também é RECUSADO, sem trim:
 * vários leitores (trava de mainnet do PSP, laudo, /admin, scripts) leem a env crua, e um trim só na config criaria
 * " PUBLIC " = mainnet aqui e não-mainnet lá (Vera, Argus, Farol, 17/11).
 */
const ORIG = { rede: process.env.STELLAR_NETWORK, ef: process.env.ETHERFUSE_ENV };

async function carregar(rede: string | undefined, etherfuse = 'production') {
  vi.resetModules();
  if (rede === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = rede;
  process.env.ETHERFUSE_ENV = etherfuse;
  const config = await import('@/lib/stellar/config');
  const env = await import('@/lib/env/etherfuse');
  return { config, boot: () => env.assertEtherfuseEnvConsistency() };
}

afterEach(() => {
  if (ORIG.rede === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = ORIG.rede;
  if (ORIG.ef === undefined) delete process.env.ETHERFUSE_ENV;
  else process.env.ETHERFUSE_ENV = ORIG.ef;
  vi.resetModules();
});

describe('STELLAR_NETWORK no boot', () => {
  it.each([['vazia', ''], ['só espaços', '   '], ['minúscula', 'public'], ['desconhecida', 'MAINNET'], ['futurenet', 'FUTURENET']])(
    '%s (%j) → o boot recusa',
    async (_r, v) => {
      const { boot } = await carregar(v);
      expect(boot).toThrow(/STELLAR_NETWORK inválido/);
    },
  );

  it('vazia NÃO vira TESTNET em silêncio (a config expõe o vazio para o boot recusar)', async () => {
    const { config } = await carregar('');
    expect(config.STELLAR_NETWORK).toBe('');
  });

  it.each([['" PUBLIC "', ' PUBLIC '], ['" TESTNET "', ' TESTNET '], ['"PUBLIC\\n"', 'PUBLIC\n']])(
    '%s (com espaço) → o boot RECUSA (sem trim: a env crua e a config nunca discordam)',
    async (_r, v) => {
      const { boot } = await carregar(v);
      expect(boot).toThrow(/STELLAR_NETWORK inválido/);
    },
  );

  it('"PUBLIC" exato → passphrase e Horizon da mainnet, e o boot aceita', async () => {
    const { config, boot } = await carregar('PUBLIC');
    expect(config.STELLAR_NETWORK).toBe('PUBLIC');
    expect(config.networkPassphrase).toMatch(/Public Global Stellar Network/);
    expect(config.horizonUrl).toBe('https://horizon.stellar.org');
    expect(boot).not.toThrow();
  });

  it('ausente → TESTNET (padrão de hoje, fail-safe)', async () => {
    const { config, boot } = await carregar(undefined, 'sandbox');
    expect(config.STELLAR_NETWORK).toBe('TESTNET');
    expect(config.networkPassphrase).toMatch(/Test SDF Network/);
    expect(boot).not.toThrow();
  });
});
