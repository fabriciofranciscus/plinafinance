import { expect, test } from '@playwright/test';

/**
 * Liquidação quote — calcula NAV/token sem submeter nada on-chain.
 * Cobre Sprint 4 sem precisar de Privy.
 *
 * Se o pool não tiver cotas vivas, o NAV/token cai pra 0 (paridade default
 * do MVP). Aceitamos esse caso e validamos só o contrato.
 */

test.describe('liquidar · quote', () => {
  test('quote para 100 PLINARF retorna shape esperado', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/quote', {
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
    // BRL equivalente = amount × NAV/token (com tolerância floating)
    expect(json.brlEquivalente).toBeCloseTo(100 * json.navPorTokenAtual, 4);
  });

  test('quote rejeita amount inválido', async ({ request }) => {
    const r1 = await request.post('/api/investidor/liquidar/quote', {
      data: {},
    });
    expect(r1.status()).toBe(400);

    const r2 = await request.post('/api/investidor/liquidar/quote', {
      data: { amountPlinarf: '-50' },
    });
    expect(r2.status()).toBe(500); // service joga Error
  });
});

test.describe('liquidar · build/submit guard', () => {
  test('build rejeita pubkey inválida', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      data: { pubkey: 'XINVALID', amount: '10' },
    });
    expect(res.status()).toBe(400);
  });

  test('build rejeita amount ausente', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/build', {
      data: { pubkey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(res.status()).toBe(400);
  });

  test('submit rejeita campos faltando', async ({ request }) => {
    const res = await request.post('/api/investidor/liquidar/submit', {
      data: { xdr: 'AAAA', pubkey: 'GBAD' },
    });
    expect(res.status()).toBe(400);
  });
});
