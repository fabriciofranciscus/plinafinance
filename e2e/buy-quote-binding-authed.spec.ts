import { expect, test } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  seedE2eInvestidorLight,
  type E2eInvestidorLightSeed,
} from './fixtures/seed-e2e-investidor-light';
import { cleanupE2eInvestidor } from './fixtures/seed-e2e-investidor';

/**
 * Contract tests autenticados pra `/api/investidor/quote` e
 * `/api/investidor/buy/swap/{build,submit}`.
 *
 * Foca no binding amount-via-quoteId (gap fechado 2026-05-18): emissão não
 * aceita mais `amount` arbitrário do body. Aqui validamos que:
 *  - quote rejeita body sem campos (400)
 *  - quote 403 quando customerId/stellarAddress não batem com user
 *  - swap/submit ignora `amount` legacy (zod strict + quoteId required → 400)
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

test.describe('quote', () => {
  test('campos faltando (customerId, stellarAddress) → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/quote', {
      headers: authHeaders,
      data: { amountBrl: '100' },
    });
    expect(res.status()).toBe(400);
  });

  test('customerId ≠ user.etherfuseCustomerId → 403', async ({ request }) => {
    const res = await request.post('/api/investidor/quote', {
      headers: authHeaders,
      data: {
        amountBrl: '100',
        customerId: 'customer-inexistente',
        stellarAddress: seed.pubkey,
      },
    });
    expect(res.status()).toBe(403);
  });

  test('stellarAddress ≠ user.publicKey → 403', async ({ request }) => {
    const res = await request.post('/api/investidor/quote', {
      headers: authHeaders,
      data: {
        amountBrl: '100',
        customerId: seed.etherfuseCustomerId,
        stellarAddress: OTHER_PK,
      },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('swap/build · binding', () => {
  test('body vazio → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      headers: authHeaders,
      data: {},
    });
    expect(res.status()).toBe(400);
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

test.describe('swap/submit · sem amount no body', () => {
  test('quoteId ausente → 400', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      headers: authHeaders,
      data: {
        investorPubkey: seed.pubkey,
        signatureHex: 'a'.repeat(128),
        xdr: 'AAAA',
        distributorSigBase64: 'aGVsbG8=',
        distributorPubkey: Keypair.random().publicKey(),
      },
    });
    expect(res.status()).toBe(400);
  });

  test('amount legacy bypass → 400 (zod strict + quoteId required)', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      headers: authHeaders,
      data: { amount: '999999999' },
    });
    expect(res.status()).toBe(400);
  });
});
