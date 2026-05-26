import { expect, test } from '@playwright/test';

/**
 * Pool summary — endpoint público, contrato estável.
 * Migrado pro envelope `{ data, error: null }` + header `x-request-id`.
 */

test('GET /api/pool/summary retorna NAV + tokens vivos', async ({
  request,
}) => {
  const res = await request.get('/api/pool/summary');
  expect(res.status()).toBe(200);
  expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  const envelope = (await res.json()) as {
    data: {
      assetCode: string;
      network: string;
      issuerPubkey: string;
      distributorPubkey: string;
      navTotal: number;
      tokensVivos: number;
      cotasCount: number;
      tipoBemCount: Record<string, number>;
      navPorTipo: Record<string, number>;
    };
    error: null;
  };
  expect(envelope.error).toBeNull();
  const { data } = envelope;
  expect(data.assetCode).toBe('PLINARF');
  // ParametrosPool singleton pode não existir se o DB não foi seedado;
  // nesse caso issuer/distributor vêm como string vazia.
  if (data.issuerPubkey) expect(data.issuerPubkey).toMatch(/^G/);
  if (data.distributorPubkey) expect(data.distributorPubkey).toMatch(/^G/);
  expect(typeof data.navTotal).toBe('number');
  expect(typeof data.tokensVivos).toBe('number');
  expect(typeof data.cotasCount).toBe('number');
});
