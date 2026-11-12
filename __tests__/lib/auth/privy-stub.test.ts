import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { _resetPrivyStubLogForTests, motivoStubRecusado, privyStubAtivo } from '@/lib/auth/privy-stub';
import { createRateLimiter } from '@/lib/rate-limit/in-memory';

/** RT-1 (Argus, 12/11): o stub do Privy só liga em teste, nunca em produção Vercel nem em mainnet. */
const ENV_KEYS = ['PRIVY_VERIFY_STUB', 'NODE_ENV', 'E2E_STUB', 'VERCEL_ENV', 'VERCEL', 'STELLAR_NETWORK'] as const;
const salvo: Record<string, string | undefined> = {};

function ambiente(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = env[k] as string;
  }
}

beforeEach(() => {
  for (const k of ENV_KEYS) salvo[k] = process.env[k];
  _resetPrivyStubLogForTests();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (salvo[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = salvo[k] as string;
  }
});

describe('privyStubAtivo — os 3 casos do Atlas', () => {
  it('1) flag ligada em NODE_ENV=test: ativo', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' })).toBe(true);
  });
  it('1b) flag ligada com E2E_STUB=1 (dev server do e2e): ativo', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'development', E2E_STUB: '1' })).toBe(true);
  });
  it('2) VERCEL_ENV=production recusa, mesmo com E2E_STUB=1 ou NODE_ENV=test', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', VERCEL_ENV: 'production', E2E_STUB: '1', NODE_ENV: 'test' })).toBe(false);
    expect(motivoStubRecusado({ VERCEL_ENV: 'production', NODE_ENV: 'test' })).toBe('VERCEL_ENV_PRODUCTION');
  });
  it('3) STELLAR_NETWORK=PUBLIC recusa, mesmo com E2E_STUB=1 ou NODE_ENV=test', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', STELLAR_NETWORK: 'PUBLIC', E2E_STUB: '1', NODE_ENV: 'test' })).toBe(false);
    expect(motivoStubRecusado({ STELLAR_NETWORK: 'PUBLIC', NODE_ENV: 'test' })).toBe('STELLAR_NETWORK_PUBLIC');
  });
});

describe('privyStubAtivo — Preview e runtime da Vercel (RT-1, adendo do Argus)', () => {
  it('Preview com E2E_STUB=1 e a flag (duas variáveis no escopo Preview) → recusa', () => {
    const env = { PRIVY_VERIFY_STUB: 'true', E2E_STUB: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production' };
    expect(privyStubAtivo(env)).toBe(false);
    expect(motivoStubRecusado(env)).toBe('VERCEL_ENV_PREVIEW');
  });
  it('Preview com NODE_ENV=test também recusa', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', VERCEL_ENV: 'preview' })).toBe(false);
  });
  it('qualquer runtime da Vercel (VERCEL=1), mesmo sem VERCEL_ENV, com E2E_STUB=1 → recusa', () => {
    const env = { PRIVY_VERIFY_STUB: 'true', E2E_STUB: '1', VERCEL: '1' };
    expect(privyStubAtivo(env)).toBe(false);
    expect(motivoStubRecusado(env)).toBe('VERCEL_RUNTIME');
  });
  it('local/CI fora da Vercel continua ligando (VERCEL_ENV e VERCEL ausentes)', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', E2E_STUB: '1', NODE_ENV: 'development' })).toBe(true);
  });
  it('o limiter volta a valer no Preview e no runtime da Vercel', () => {
    for (const extra of [{ VERCEL_ENV: 'preview' }, { VERCEL: '1' }]) {
      ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', ...extra });
      const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
      expect([rl.consume('a'), rl.consume('a')]).toEqual([true, false]);
    }
  });
});

describe('privyStubAtivo — demais combinações (fail-closed)', () => {
  it.each([
    ['produção sem E2E_STUB', { NODE_ENV: 'production' }],
    ['desenvolvimento sem E2E_STUB', { NODE_ENV: 'development' }],
    ['NODE_ENV ausente', {}],
    ['E2E_STUB diferente de 1', { NODE_ENV: 'production', E2E_STUB: 'true' }],
  ])('flag ligada em %s: recusa', (_n, env) => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', ...env })).toBe(false);
    expect(motivoStubRecusado(env)).toBe('FORA_DE_AMBIENTE_DE_TESTE');
  });
  it.each(['false', '1', 'TRUE', '', undefined])('flag %s: desligado, mesmo em teste', (flag) => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: flag, NODE_ENV: 'test', E2E_STUB: '1' })).toBe(false);
  });
  it('flag desligada não faz barulho no log', () => {
    privyStubAtivo({ NODE_ENV: 'production' });
    expect(console.error).not.toHaveBeenCalled();
  });
  it('recusa loga o motivo UMA vez por motivo, sem segredo nem valores de env', () => {
    const env = { PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production', PRIVY_APP_SECRET: 'segredo-123', OPS_CRON_SECRET: 'x'.repeat(40) };
    privyStubAtivo(env);
    privyStubAtivo(env);
    privyStubAtivo({ ...env, VERCEL_ENV: 'production' });
    const linhas = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c.join(' '));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatch(/RECUSADO \(FORA_DE_AMBIENTE_DE_TESTE\)/);
    expect(linhas[1]).toMatch(/RECUSADO \(VERCEL_ENV_PRODUCTION\)/);
    expect(linhas.join('\n')).not.toMatch(/segredo-123|xxxx/);
  });
});

describe('efeito no rate limit (o bypass segue o mesmo guard)', () => {
  it('com o stub ativo (teste), o limiter não bloqueia', () => {
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect([rl.consume('a'), rl.consume('a'), rl.consume('a')]).toEqual([true, true, true]);
  });
  it('flag ligada em produção Vercel: o limiter VOLTA a valer', () => {
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', VERCEL_ENV: 'production' });
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect([rl.consume('a'), rl.consume('a')]).toEqual([true, false]);
  });
  it('flag ligada em mainnet: o limiter volta a valer', () => {
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', STELLAR_NETWORK: 'PUBLIC' });
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect([rl.consume('a'), rl.consume('a')]).toEqual([true, false]);
  });
});

describe('efeito no login (getPrivyClient)', () => {
  const carregar = async () => {
    vi.resetModules();
    return import('@/lib/wallet/privy');
  };
  it('stub ativo: o cliente de mentira aceita o Bearer e2e-stub-<pubkey>', async () => {
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    const { getPrivyClient } = await carregar();
    const c = getPrivyClient() as unknown as { verifyAuthToken: (t: string) => Promise<{ userId: string }> };
    await expect(c.verifyAuthToken(`e2e-stub-${Keypair.random().publicKey()}`)).resolves.toBeDefined();
  });
  it.each([
    ['produção Vercel', { VERCEL_ENV: 'production' }],
    ['mainnet', { STELLAR_NETWORK: 'PUBLIC' }],
    ['fora de teste', { NODE_ENV: 'production' }],
  ])('stub recusado (%s): NÃO cria o cliente de mentira; exige as credenciais reais do Privy', async (_n, extra) => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', ...extra });
    const { getPrivyClient } = await carregar();
    expect(() => getPrivyClient()).toThrow(/PRIVY_APP_ID e PRIVY_APP_SECRET/);
  });
});
