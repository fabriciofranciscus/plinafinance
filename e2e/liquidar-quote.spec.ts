import { expect, test } from '@playwright/test';

/**
 * Auth-guard contract — `/api/investidor/liquidar/**` exige Bearer Privy
 * (lib/wallet/auth-guard.ts). Sem token, 401 antes do body.
 *
 * Body/resource validation (amountPlinarf, pubkey, NAV calc) coberta em
 * __tests__/api/investidor/liquidar/**.
 */

test.describe('liquidar · auth guard sem Bearer', () => {
  test('liquidar/quote → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/quote', {
      data: { amountPlinarf: '100' },
    });
    expect(res.status()).toBe(401);
  });

  test('liquidar/build → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      data: { pubkey: 'XINVALID', amount: '10' },
    });
    expect(res.status()).toBe(401);
  });

  test('liquidar/submit → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/submit', {
      data: { xdr: 'AAAA', pubkey: 'GBAD' },
    });
    expect(res.status()).toBe(401);
  });
});
