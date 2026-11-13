/**
 * QA (Vera) do RT-1: tabela de verdade EXAUSTIVA contra um oráculo independente, efeito real em getPrivyClient e no
 * rate limit (módulos recarregados por ambiente), rigidez do token do stub, log único sem segredo e a lacuna do Preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { _resetPrivyStubLogForTests, motivoStubRecusado, privyStubAtivo } from '@/lib/auth/privy-stub';

const ENV_KEYS = ['PRIVY_VERIFY_STUB', 'NODE_ENV', 'E2E_STUB', 'VERCEL_ENV', 'VERCEL', 'STELLAR_NETWORK', 'PRIVY_APP_ID', 'PRIVY_APP_SECRET'] as const;
const salvo: Record<string, string | undefined> = {};
const PK = Keypair.random().publicKey();

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
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Oráculo escrito de forma independente (por tabela, não por if): quando o stub DEVE estar ligado. */
function oraculo(e: Record<string, string | undefined>): boolean {
  const flag = e.PRIVY_VERIFY_STUB === 'true';
  const ambienteDeTeste = e.NODE_ENV === 'test' || e.E2E_STUB === '1';
  // 6629a95: QUALQUER VERCEL_ENV ou VERCEL não vazio (após trim) recusa; mainnet sem diferenciar caixa/espaços.
  const definido = (v: string | undefined) => (v ?? '').trim().length > 0;
  const proibido = definido(e.VERCEL_ENV) || definido(e.VERCEL) || (e.STELLAR_NETWORK ?? '').trim().toUpperCase() === 'PUBLIC';
  return flag && ambienteDeTeste && !proibido;
}

describe('tabela de verdade exaustiva (~65.000 combinações) = oráculo independente', () => {
  const FLAG = [undefined, 'true', 'TRUE', 'True', '1', 'false', ' true', 'true '];
  const NODE = [undefined, 'test', 'development', 'production', 'Test'];
  const E2E = [undefined, '1', 'true', '0', '', ' 1'];
  const VERCEL = [undefined, '', '   ', 'production', 'preview', 'development', 'Production', ' production', '  preview '];
  const REDE = [undefined, 'TESTNET', 'PUBLIC', 'public', 'FUTURENET', 'PUBLIC '];
  const RUNTIME = [undefined, '', '1', 'true', '0'];

  it('privyStubAtivo(env) === oráculo para TODAS as combinações (inclui variações de caixa e espaços)', () => {
    let n = 0;
    const divergentes: string[] = [];
    for (const f of FLAG) for (const nd of NODE) for (const e of E2E) for (const v of VERCEL) for (const r of REDE) for (const rt of RUNTIME) {
      const env = { PRIVY_VERIFY_STUB: f, NODE_ENV: nd, E2E_STUB: e, VERCEL_ENV: v, STELLAR_NETWORK: r, VERCEL: rt };
      n++;
      if (privyStubAtivo(env) !== oraculo(env)) divergentes.push(JSON.stringify(env));
    }
    expect(n).toBe(8 * 5 * 6 * 9 * 6 * 5);
    expect(divergentes).toEqual([]);
  });

  it('nunca LIGA quando a flag não é exatamente "true" (TRUE, True, 1, espaços, false), mesmo em teste', () => {
    for (const f of [undefined, 'TRUE', 'True', '1', 'false', ' true', 'true ', '']) {
      expect(privyStubAtivo({ PRIVY_VERIFY_STUB: f, NODE_ENV: 'test', E2E_STUB: '1' })).toBe(false);
    }
  });

  it('VERCEL_ENV=production e STELLAR_NETWORK=PUBLIC têm precedência sobre TUDO o que liga (NODE_ENV=test, E2E_STUB=1)', () => {
    for (const bloqueio of [{ VERCEL_ENV: 'production' }, { STELLAR_NETWORK: 'PUBLIC' }, { VERCEL_ENV: 'production', STELLAR_NETWORK: 'PUBLIC' }]) {
      expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', E2E_STUB: '1', ...bloqueio })).toBe(false);
    }
  });

  it('o motivo recusado segue a prioridade: produção Vercel > mainnet > fora de ambiente de teste', () => {
    expect(motivoStubRecusado({ VERCEL_ENV: 'production', STELLAR_NETWORK: 'PUBLIC' })).toBe('VERCEL_ENV_PRODUCTION');
    expect(motivoStubRecusado({ STELLAR_NETWORK: 'PUBLIC', NODE_ENV: 'test' })).toBe('STELLAR_NETWORK_PUBLIC');
    expect(motivoStubRecusado({ NODE_ENV: 'development' })).toBe('FORA_DE_AMBIENTE_DE_TESTE');
    expect(motivoStubRecusado({ NODE_ENV: 'test' })).toBeNull();
    expect(motivoStubRecusado({ NODE_ENV: 'development', E2E_STUB: '1' })).toBeNull();
  });

  it('SEM o argumento, lê o process.env (é assim que os dois consumidores o chamam)', () => {
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    expect(privyStubAtivo()).toBe(true);
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production' });
    expect(privyStubAtivo()).toBe(false);
  });
});

describe('log: uma vez por motivo, sem segredo nem valor de env', () => {
  it('1000 chamadas recusadas → 1 linha por motivo; 3 motivos → 3 linhas; nenhum valor de env sensível aparece', () => {
    const spy = vi.mocked(console.error);
    const segredos = { PRIVY_APP_SECRET: 'segredo-que-nao-pode-aparecer-123', PRIVY_APP_ID: 'app-id-xyz' };
    for (let i = 0; i < 1000; i++) privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production', ...segredos });
    for (let i = 0; i < 1000; i++) privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', VERCEL_ENV: 'production', ...segredos });
    for (let i = 0; i < 1000; i++) privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', STELLAR_NETWORK: 'PUBLIC', ...segredos });
    expect(spy).toHaveBeenCalledTimes(3);
    const texto = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(texto).toMatch(/FORA_DE_AMBIENTE_DE_TESTE/);
    expect(texto).toMatch(/VERCEL_ENV_PRODUCTION/);
    expect(texto).toMatch(/STELLAR_NETWORK_PUBLIC/);
    expect(texto).not.toMatch(/segredo-que-nao-pode|app-id-xyz/);
  });

  it('flag desligada ou stub ligado: nenhum log', () => {
    privyStubAtivo({ NODE_ENV: 'production' });
    privyStubAtivo({ PRIVY_VERIFY_STUB: 'false', NODE_ENV: 'production' });
    privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('efeito REAL no login (getPrivyClient, módulo recarregado por ambiente)', () => {
  async function cliente(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    vi.resetModules();
    ambiente(env);
    const m = await import('@/lib/wallet/privy');
    return () => m.getPrivyClient();
  }

  it('ambiente de teste + flag: o cliente de mentira aceita `e2e-stub-<G…>` e devolve o userId do e2e', async () => {
    const get = await cliente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    const c = get();
    expect(await c.verifyAuthToken(`e2e-stub-${PK}`)).toMatchObject({ userId: `did:privy:e2e-${PK}` });
  });

  it.each([
    ['produção Vercel', { VERCEL_ENV: 'production', NODE_ENV: 'test', E2E_STUB: '1' }],
    ['mainnet', { STELLAR_NETWORK: 'PUBLIC', NODE_ENV: 'test', E2E_STUB: '1' }],
    ['dev sem E2E_STUB', { NODE_ENV: 'development' }],
    ['NODE_ENV production (next start)', { NODE_ENV: 'production' }],
    ['Preview sem E2E_STUB', { VERCEL_ENV: 'preview', NODE_ENV: 'production' }],
  ])('recusado em %s: SEM credenciais reais getPrivyClient LANÇA (nunca devolve o stub); COM credenciais, o token de stub é recusado pelo verificador real', async (_n, env) => {
    const sem = await cliente({ PRIVY_VERIFY_STUB: 'true', ...env } as never);
    expect(() => sem()).toThrow(/PRIVY_APP_ID e PRIVY_APP_SECRET/);
    const com = await cliente({ PRIVY_VERIFY_STUB: 'true', PRIVY_APP_ID: 'app-id-falso', PRIVY_APP_SECRET: 'secret-falso', ...env } as never);
    const real = com();
    // é o cliente REAL do Privy (sem rede aqui: o importante é que NÃO aceita o token de stub como login)
    await expect(real.verifyAuthToken(`e2e-stub-${PK}`)).rejects.toBeDefined();
  });

  it('rigidez do token do stub (quando ativo): só `e2e-stub-` + chave Stellar G… de 56 caracteres; o resto é recusado', async () => {
    const get = await cliente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    const c = get();
    for (const ruim of [`e2e-stub-${PK.toLowerCase()}`, `e2e-stub-${PK}x`, `e2e-stub-${PK.slice(0, 55)}`, `E2E-STUB-${PK}`, `Bearer e2e-stub-${PK}`, `e2e-stub-${PK}\n`, 'e2e-stub-', '', `e2e-stub-S${PK.slice(1)}`, `xe2e-stub-${PK}`]) {
      await expect(c.verifyAuthToken(ruim)).rejects.toThrow();
    }
  });
});

describe('efeito REAL no rate limit', () => {
  async function limiter(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    vi.resetModules();
    ambiente(env);
    const { createRateLimiter } = await import('@/lib/rate-limit/in-memory');
    return createRateLimiter({ limit: 3, windowMs: 60_000 });
  }
  const rodar = (rl: { consume(k: string): boolean | Promise<boolean> }, n: number) => Promise.all(Array.from({ length: n }, () => Promise.resolve(rl.consume('ip1'))));

  it('stub ativo: nunca bloqueia (10 pedidos com limite 3)', async () => {
    const rl = await limiter({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    expect((await rodar(rl, 10)).every(Boolean)).toBe(true);
  });

  it.each([
    ['produção Vercel', { VERCEL_ENV: 'production', NODE_ENV: 'test', E2E_STUB: '1' }],
    ['mainnet', { STELLAR_NETWORK: 'PUBLIC', NODE_ENV: 'test', E2E_STUB: '1' }],
    ['dev sem E2E_STUB', { NODE_ENV: 'development' }],
    ['next start (production)', { NODE_ENV: 'production' }],
  ])('flag ligada mas RECUSADA em %s: o limite VALE (3 passam, o 4º é bloqueado)', async (_n, env) => {
    const rl = await limiter({ PRIVY_VERIFY_STUB: 'true', ...env } as never);
    const r = await rodar(rl, 6);
    expect(r.filter(Boolean)).toHaveLength(3);
  });

  it('o guard é avaliado a CADA consume: ligar e desligar o ambiente em tempo de execução muda o comportamento imediatamente', async () => {
    const rl = await limiter({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test' });
    expect((await rodar(rl, 5)).every(Boolean)).toBe(true); // bypass
    ambiente({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production' }); // o ambiente "vira" produção
    expect(await Promise.resolve(rl.consume('ip2'))).toBe(true);
    const depois = await rodar(rl, 6);
    expect(depois.filter(Boolean).length).toBeLessThan(6); // agora conta
  });

  it('sem a flag o limiter funciona normalmente em qualquer ambiente (inclui NODE_ENV=test)', async () => {
    const rl = await limiter({ NODE_ENV: 'test' });
    expect((await rodar(rl, 6)).filter(Boolean)).toHaveLength(3);
  });
});

describe('lacunas de configuração (observações)', () => {
  // F-RT1-1 (MÉDIO, FECHADO em ff89f6e): o banco de Preview é o mesmo da produção; o stub é recusado em Preview e em
  // qualquer runtime da Vercel, mesmo com E2E_STUB=1.
  it('F-RT1-1 — Preview da Vercel (VERCEL_ENV=preview) ou qualquer runtime Vercel (VERCEL=1) com E2E_STUB=1 e a flag → RECUSADO, com o motivo certo', () => {
    const base = { PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production', E2E_STUB: '1' };
    expect(privyStubAtivo({ ...base, VERCEL_ENV: 'preview' })).toBe(false);
    expect(motivoStubRecusado({ ...base, VERCEL_ENV: 'preview' })).toBe('VERCEL_ENV_PREVIEW');
    expect(privyStubAtivo({ ...base, VERCEL: '1' })).toBe(false);
    expect(motivoStubRecusado({ ...base, VERCEL: '1' })).toBe('VERCEL_RUNTIME'); // VERCEL_ENV ausente (runtime sem a variável) também cai
    expect(privyStubAtivo({ ...base, NODE_ENV: 'test', VERCEL: '1', VERCEL_ENV: 'development' })).toBe(false); // até `vercel dev`/build
  });

  it('6629a95 — QUALQUER VERCEL_ENV ou VERCEL não vazio recusa (development, "  preview ", Production com P maiúsculo, VERCEL=true/0); vazio ou só espaços conta como ausente', () => {
    const base = { PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', E2E_STUB: '1' };
    for (const v of ['development', '  preview ', 'Production', 'qualquer', '0']) expect(privyStubAtivo({ ...base, VERCEL_ENV: v })).toBe(false);
    for (const v of ['true', '0', ' 1 ', 'x']) expect(privyStubAtivo({ ...base, VERCEL: v })).toBe(false);
    expect(motivoStubRecusado({ ...base, VERCEL_ENV: 'development' })).toBe('VERCEL_ENV_DEFINIDO');
    expect(motivoStubRecusado({ ...base, VERCEL: 'true' })).toBe('VERCEL_RUNTIME');
    expect(privyStubAtivo({ ...base, VERCEL_ENV: '', VERCEL: '   ' })).toBe(true); // vazio/espaços = ausente (local/CI)
  });

  it('F-RT1-1 (o que ainda liga) — host próprio (sem VERCEL/VERCEL_ENV) com NODE_ENV=production + E2E_STUB=1 + flag liga o stub (as 4 envs são removidas por nome no Production/Preview pelo Farol)', () => {
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'production', E2E_STUB: '1' })).toBe(true);
  });

  it('F-RT1-2 (FECHADO em 6629a95) — "public"/"PUBLIC " (caixa/espaço) agora contam como mainnet para o guard (mais estrito que o config.ts do app, que só reconhece "PUBLIC" exato: fail-closed)', () => {
    for (const r of ['PUBLIC', 'public', 'PUBLIC ', ' Public ']) expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', STELLAR_NETWORK: r })).toBe(false);
    expect(privyStubAtivo({ PRIVY_VERIFY_STUB: 'true', NODE_ENV: 'test', STELLAR_NETWORK: 'TESTNET' })).toBe(true);
  });
});
