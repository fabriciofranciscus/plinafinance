import { expect, test } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  seedE2eInvestidorLight,
  type E2eInvestidorLightSeed,
} from './fixtures/seed-e2e-investidor-light';
import { cleanupE2eInvestidor } from './fixtures/seed-e2e-investidor';

/**
 * Contract tests pras rotas `/api/investidor/buy/**` *autenticadas*.
 *
 * Requer `E2E_STUB=1` (Privy stub aceita Bearer `e2e-stub-<pubkey>` →
 * lib/wallet/privy.ts:34). Seed leve cria Investidor no DB sem on-chain
 * (sem Friendbot, sem Etherfuse customer real).
 *
 * Cobre o path *após* o auth guard: Zod 400 em body inválido, ownership
 * 403, lookup 404. Pareado com __tests__/api/investidor/buy/** mas valida
 * o wiring real (Next route handler + Prisma + Zod).
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

test.describe('onramp/create', () => {
  test('body vazio → 400 (Zod strict)', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/create', {
      headers: authHeaders,
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('quoteId inexistente → 404', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/create', {
      headers: authHeaders,
      data: { quoteId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('onramp/status', () => {
  test('sem orderId → 400', async ({ request }) => {
    const res = await request.get('/api/investidor/buy/onramp/status', {
      headers: authHeaders,
    });
    expect(res.status()).toBe(400);
  });

  test('orderId inexistente → 404', async ({ request }) => {
    const res = await request.get(
      '/api/investidor/buy/onramp/status?orderId=nonexistent',
      { headers: authHeaders },
    );
    expect(res.status()).toBe(404);
  });
});

test.describe('onramp/sandbox-pay', () => {
  test('body vazio → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/sandbox-pay', {
      headers: authHeaders,
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('orderId inexistente → 404', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/sandbox-pay', {
      headers: authHeaders,
      data: { orderId: 'mock-nonexistent' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('swap/build', () => {
  test('body vazio → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      headers: authHeaders,
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('investorPubkey ≠ user → 403 (defense in depth)', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      headers: authHeaders,
      data: {
        quoteId: '00000000-0000-0000-0000-000000000000',
        investorPubkey: OTHER_PK,
      },
    });
    expect(res.status()).toBe(403);
  });

  test('quoteId inexistente → 404', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      headers: authHeaders,
      data: {
        quoteId: '00000000-0000-0000-0000-000000000000',
        investorPubkey: seed.pubkey,
      },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('swap/submit', () => {
  test('campos faltando → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      headers: authHeaders,
      data: { quoteId: 'x' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('trust-tesouro/build', () => {
  test('pubkey malformada → 400 (Zod stellarPubkey)', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/trust-tesouro/build', {
      headers: authHeaders,
      data: { pubkey: 'XINVALID' },
    });
    expect(res.status()).toBe(400);
  });

  test('pubkey ≠ user → 403', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/trust-tesouro/build', {
      headers: authHeaders,
      data: { pubkey: OTHER_PK },
    });
    expect(res.status()).toBe(403);
  });
});
