import { expect, test } from '@playwright/test';

/**
 * Auth-guard contract — `/api/investidor/quote` e `/buy/swap/{build,submit}`
 * exigem Bearer Privy (lib/wallet/auth-guard.ts). Sem token, 401 antes do body.
 *
 * Body/resource validation (incl. amount-binding via quoteId) coberta em
 * __tests__/api/investidor/{quote,buy/swap}/**.
 *
 * Mantemos também os asserts de rotas legacy removidas (404) — Next devolve
 * antes do handler, sem passar pelo auth guard.
 */

test.describe('quote/swap · auth guard sem Bearer', () => {
  test('quote → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/quote', {
      data: { amountBrl: '100' },
    });
    expect(res.status()).toBe(401);
  });

  test('swap/build → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('swap/submit → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      data: { amount: '999999999' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('legacy · rotas removidas', () => {
  test('/buy/build retorna 404', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/build', {
      data: { pubkey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(res.status()).toBe(404);
  });

  test('/buy/submit retorna 404', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/submit', {
      data: {},
    });
    expect(res.status()).toBe(404);
  });
});
