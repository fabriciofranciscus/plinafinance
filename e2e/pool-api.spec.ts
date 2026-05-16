import { expect, test } from '@playwright/test';

/**
 * Pool summary — endpoint público, contrato estável.
 */

test('GET /api/pool/summary retorna NAV + tokens vivos', async ({
  request,
}) => {
  const res = await request.get('/api/pool/summary');
  expect(res.status()).toBe(200);
  const json = (await res.json()) as {
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
  expect(json.assetCode).toBe('PLINARF');
  expect(json.issuerPubkey).toMatch(/^G/);
  expect(json.distributorPubkey).toMatch(/^G/);
  expect(typeof json.navTotal).toBe('number');
  expect(typeof json.tokensVivos).toBe('number');
  expect(typeof json.cotasCount).toBe('number');
});
