import { expect, test } from '@playwright/test';

/**
 * Gap fechado 2026-05-18 — emissão de PLINARF não aceita mais `amount`
 * arbitrário do body. Phase 1 fechou em /buy/submit (já removido); Phase 2
 * fechou doutrinariamente: emissão depende de `quoteId` + onramp completed.
 *
 * Coverage: contratos de validação antes da signature. Happy path com Privy
 * é stub-only — fora do escopo deste spec.
 */

test.describe('quote · persiste no DB', () => {
  test('quote rejeita customerId desconhecido', async ({ request }) => {
    // Quote requer Investidor existente (FK do Quote). Sem isso, 404.
    const res = await request.post('/api/investidor/quote', {
      data: {
        amountBrl: '100',
        customerId: 'customer-inexistente',
        stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });
    expect(res.status()).toBe(404);
  });

  test('quote rejeita request com campos faltando', async ({ request }) => {
    const res = await request.post('/api/investidor/quote', {
      data: { amountBrl: '100' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('swap · build · amount binding', () => {
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

test.describe('swap · submit · sem amount no body', () => {
  test('rejeita request sem quoteId', async ({ request }) => {
    const res = await request.post('/api/investidor/buy/swap/submit', {
      data: {
        investorPubkey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        signatureHex: '0x' + 'a'.repeat(128),
        xdr: 'AAAA',
        distributorSigBase64: 'aGVsbG8=',
        distributorPubkey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('rejeita request com amount legacy (tentativa de bypass)', async ({ request }) => {
    // Mesmo se enviar `amount` no body, a rota não usa — quoteId é
    // obrigatório e o amount é derivado de Quote.toAmount server-side.
    const res = await request.post('/api/investidor/buy/swap/submit', {
      data: { amount: '999999999' },
    });
    expect(res.status()).toBe(400);
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
