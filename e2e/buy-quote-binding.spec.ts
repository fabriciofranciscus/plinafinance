import { expect, test } from '@playwright/test';

/**
 * Rotas legacy removidas — Next devolve 404 antes do handler (sem passar
 * pelo auth guard). Mantém esse contrato pra evitar regressão acidental
 * caso alguém reintroduza `/buy/build` ou `/buy/submit` no router.
 *
 * Specs autenticadas (com Bearer + seed) vivem em
 * `buy-quote-binding-authed.spec.ts` (project e2e-stub).
 */

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
