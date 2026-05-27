import { expect, test } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  seedE2eInvestidorLight,
  type E2eInvestidorLightSeed,
} from './fixtures/seed-e2e-investidor-light';
import { cleanupE2eInvestidor } from './fixtures/seed-e2e-investidor';

/**
 * Contract tests autenticados pra `/api/investidor/liquidar/**` (Sprint 4).
 *
 * Cobre: NAV calc happy path, validação Zod de amount/pubkey, ownership 403.
 * Cobertura unit em __tests__/api/investidor/liquidar/**; aqui valida o
 * wiring Next + Prisma + Zod.
 */

const OTHER_PK = Keypair.random().publicKey();
let seed: E2eInvestidorLightSeed;
let authHeaders: Record<string, string>;

test.beforeAll(async () => {
  seed = await seedE2eInvestidorLight();
  authHeaders = { Authorization: `Bearer ${seed.bearer}` };
});

test.afterAll(async () => {
  if (seed) await cleanupE2eInvestidor(seed.privyId);
});

test.describe('liquidar/quote', () => {
  test('shape retornado pra 100 PLINARF', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/quote', {
      headers: authHeaders,
      data: { amountPlinarf: '100' },
    });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as {
      amountPlinarf: number;
      navPorTokenAtual: number;
      brlEquivalente: number;
      navTotalPool: number;
      tokensVivosPool: number;
    };
    expect(json.amountPlinarf).toBe(100);
    expect(typeof json.navPorTokenAtual).toBe('number');
    expect(typeof json.brlEquivalente).toBe('number');
    expect(typeof json.navTotalPool).toBe('number');
    expect(typeof json.tokensVivosPool).toBe('number');
    expect(json.brlEquivalente).toBeCloseTo(100 * json.navPorTokenAtual, 4);
  });

  test('body vazio → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/quote', {
      headers: authHeaders,
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('amount negativo → 400 (Zod regex)', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/quote', {
      headers: authHeaders,
      data: { amountPlinarf: '-50' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('liquidar/build', () => {
  test('pubkey malformada → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      headers: authHeaders,
      data: { pubkey: 'XINVALID', amount: '10' },
    });
    expect(res.status()).toBe(400);
  });

  test('amount ausente → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      headers: authHeaders,
      data: { pubkey: seed.pubkey },
    });
    expect(res.status()).toBe(400);
  });

  test('pubkey ≠ user → 403', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      headers: authHeaders,
      data: { pubkey: OTHER_PK, amount: '10' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('liquidar/submit', () => {
  test('campos faltando → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/submit', {
      headers: authHeaders,
      data: { xdr: 'AAAA', pubkey: 'GBAD' },
    });
    expect(res.status()).toBe(400);
  });
});
