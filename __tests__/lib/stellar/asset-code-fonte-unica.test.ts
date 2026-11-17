import { afterEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Nota 1 da Vera (gate dd2d562): ASSET_CODE e ASSET_CODE_SUBORDINADA eram lidos com `??` direto em 3 pontos; com a
 * env vazia, a config virava 'PLINARF' e as rotas de trustline ficavam com ''. Fonte única: lib/stellar/config.ts
 * (assetCode) e lib/stellar/classes.ts (SUBORDINADA_ASSET_CODE), ambos com o tratamento de env vazia.
 */
describe('fonte única do código do ativo', () => {
  it('ninguém fora de lib/stellar/{config,classes}.ts lê ASSET_CODE* do ambiente', () => {
    const achados = execSync("git grep -n -E 'process\\.env\\.ASSET_CODE' -- app lib scripts || true", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith('lib/stellar/config.ts:') && !l.startsWith('lib/stellar/classes.ts:'));
    expect(achados).toEqual([]);
  });
});

async function subordinadaCom(v: string | undefined) {
  vi.resetModules();
  vi.stubEnv('ASSET_CODE_SUBORDINADA', v as string);
  return (await import('@/lib/stellar/classes')).SUBORDINADA_ASSET_CODE;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('SUBORDINADA_ASSET_CODE', () => {
  it('vazia → PLINARFB', async () => expect(await subordinadaCom('')).toBe('PLINARFB'));
  it('só espaços → PLINARFB', async () => expect(await subordinadaCom('  ')).toBe('PLINARFB'));
  it('ausente → PLINARFB', async () => expect(await subordinadaCom(undefined)).toBe('PLINARFB'));
  it('preenchida → o valor, sem espaços', async () => expect(await subordinadaCom(' PLINARFS ')).toBe('PLINARFS'));
});
