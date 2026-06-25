import { expect, test } from '@playwright/test';

/**
 * APIs do funil vendedor + comprador.
 *
 * Cobrimos somente endpoints sem side effect on-chain pra manter os
 * testes rápidos e idempotentes:
 *   - POST /api/vender/simular — só cálculo de faixa indicativa.
 *   - POST /api/comprar/reservar com body inválido — valida contract.
 *
 * Os endpoints `lead` (vendedor + comprador) escrevem on-chain (Memo.hash
 * de consentimento) e ficam fora desse spec pra não consumir XLM de
 * testnet a cada run. Cobertos via smokes manuais.
 */

test.describe('vender · simulador', () => {
  test('faixa indicativa para IMOVEL R$ 200k', async ({ request }) => {
    const res = await request.post('/api/vender/simular', {
      data: {
        tipoBem: 'IMOVEL',
        administradora: 'Bradesco',
        valorCarta: '200000',
        prazoRestanteMeses: 24,
      },
    });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as {
      desagioMinimo: number;
      desagioMaximo: number;
      valorLiquidoMinimo: number;
      valorLiquidoMaximo: number;
    };
    expect(json.desagioMinimo).toBeGreaterThan(0);
    expect(json.desagioMaximo).toBeGreaterThanOrEqual(json.desagioMinimo);
    expect(json.valorLiquidoMinimo).toBeGreaterThan(0);
    expect(json.valorLiquidoMaximo).toBeLessThan(200000);
    expect(json.valorLiquidoMaximo).toBeGreaterThanOrEqual(
      json.valorLiquidoMinimo,
    );
  });

  test('rejeita tipoBem inválido', async ({ request }) => {
    const res = await request.post('/api/vender/simular', {
      data: { tipoBem: 'OURO', valorCarta: '100000' },
    });
    expect(res.status()).toBe(400);
  });

  test('rejeita valor negativo', async ({ request }) => {
    const res = await request.post('/api/vender/simular', {
      data: { tipoBem: 'VEICULO', valorCarta: '-1' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('comprar · reservar contract', () => {
  test('exige autenticação (sem token Privy → 401)', async ({ request }) => {
    const res = await request.post('/api/comprar/reservar', {
      data: { cotaId: 'qualquer', leadCompradorId: 'alheio' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('vender · aceitar-oferta', () => {
  test('exige autenticação (sem token Privy → 401)', async ({ request }) => {
    // Aceite forjado: sem login, não deve gravar aceite on-chain de cessão
    // alheia. Guard ausente → 401 antes de qualquer side effect.
    const res = await request.post('/api/vender/aceitar-oferta', {
      data: { ofertaId: 'alheia' },
    });
    expect(res.status()).toBe(401);
  });
});
