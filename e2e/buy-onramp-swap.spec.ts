import { expect, test } from '@playwright/test';

/**
 * Phase 2 — contratos das rotas onramp + swap atômico.
 *
 * Sem Privy/wallet ativa, cobrimos os guards (validação de quoteId/order,
 * estados inválidos). Happy path completo (Privy sign + atomic submit) é
 * sandbox-mock e exige seed de DB com Investidor + Quote — fora do escopo
 * deste spec contractual.
 */

test.describe('onramp · create guards', () => {
  test('rejeita request sem quoteId', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/create', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('rejeita quoteId inexistente', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/create', {
      data: { quoteId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('onramp · status guards', () => {
  test('rejeita sem orderId', async ({ request }) => {
    const res = await request.get('/api/investidor/buy/onramp/status');
    expect(res.status()).toBe(400);
  });

  test('404 pra order inexistente', async ({ request }) => {
    const res = await request.get(
      '/api/investidor/buy/onramp/status?orderId=nonexistent',
    );
    expect(res.status()).toBe(404);
  });
});

test.describe('onramp · sandbox-pay guards', () => {
  test('rejeita sem orderId', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/sandbox-pay', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('404 pra order inexistente', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/onramp/sandbox-pay', {
      data: { orderId: 'mock-nonexistent' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('swap · build guards', () => {
  test('rejeita sem quoteId/investorPubkey', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('rejeita quoteId inexistente', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/build', {
      data: {
        quoteId: '00000000-0000-0000-0000-000000000000',
        investorPubkey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('swap · submit guards', () => {
  test('rejeita request com campos faltando', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      data: { quoteId: 'x' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('trust-tesouro · build guards', () => {
  test('rejeita pubkey inválida', async ({ request }) => {
    const res = await request.post(
      '/api/investidor/buy/trust-tesouro/build',
      { data: { pubkey: 'XINVALID' } },
    );
    expect(res.status()).toBe(400);
  });
});
