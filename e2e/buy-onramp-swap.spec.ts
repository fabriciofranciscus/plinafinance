import { expect, test } from '@playwright/test';

/**
 * Auth-guard contract — rotas `/api/investidor/buy/**` exigem Bearer Privy
 * (lib/wallet/auth-guard.ts). Sem token, retornam 401 antes de qualquer
 * validação de body.
 *
 * Body/resource validation coberta em __tests__/api/investidor/buy/**.
 * E2e aqui valida só o auth guard (defense in depth, CVM 175 audit).
 */

test.describe('buy · auth guard sem Bearer', () => {
  test('onramp/create → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/create', {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('onramp/status → 401', async ({ request }) => {
    const res = await request.get('/api/investidor/buy/onramp/status');
    expect(res.status()).toBe(401);
  });

  test('onramp/sandbox-pay → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/sandbox-pay', {
      data: {},
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
      data: { quoteId: 'x' },
    });
    expect(res.status()).toBe(401);
  });

  test('trust-tesouro/build → 401', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/trust-tesouro/build', {
      data: { pubkey: 'XINVALID' },
    });
    expect(res.status()).toBe(401);
  });
});
