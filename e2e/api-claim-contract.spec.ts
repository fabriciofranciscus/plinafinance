import { expect, test } from '@playwright/test';

/**
 * Contratos das rotas novas:
 *   - POST /api/investidor/bank-account/register (PLINA-MOD-006)
 *   - POST /api/investidor/buy/claim/build (PLINA-MOD-007)
 *   - POST /api/investidor/buy/claim/submit (PLINA-MOD-007)
 *
 * Sem Privy/wallet ativa, cobrimos os guards de validação + auth. Happy
 * path completo (Privy sign + claim/burn) exige sandbox seed e fica no
 * smoke (`npm run smoke:etherfuse`).
 */

test.describe('bank-account/register · guards', () => {
  test('rejeita request sem campos PIX', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/bank-account/register',
      { data: {} },
    );
    // 401 sem Bearer ou 400 sem campos — ambos previnem registro.
    expect([400, 401]).toContain(res.status());
  });

  test('rejeita request sem pixKey', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/bank-account/register',
      {
        data: {
          pixKeyType: 'cpf',
          cpf: '52998224725',
          firstName: 'Plina',
          lastName: 'Test',
        },
      },
    );
    expect([400, 401]).toContain(res.status());
  });
});

test.describe('claim/build · guards', () => {
  test('rejeita request sem orderId', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/buy/claim/build',
      { data: {} },
    );
    expect([400, 401]).toContain(res.status());
  });

  test('404 ou 401 pra order inexistente', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/buy/claim/build',
      { data: { orderId: 'mock-nonexistent' } },
    );
    expect([401, 404]).toContain(res.status());
  });
});

test.describe('claim/submit · guards', () => {
  test('rejeita request com campos faltando', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/buy/claim/submit',
      { data: { orderId: 'x' } },
    );
    expect([400, 401]).toContain(res.status());
  });

  test('rejeita sem signatureHex', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/buy/claim/submit',
      { data: { orderId: 'x', xdr: 'AAAA' } },
    );
    expect([400, 401]).toContain(res.status());
  });
});
