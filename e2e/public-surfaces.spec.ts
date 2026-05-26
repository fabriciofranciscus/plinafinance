import { expect, test } from '@playwright/test';

/**
 * Smoke das superfícies públicas — cada rota renderiza 200 e contém um
 * marcador estável (texto na hero) que sinaliza que o page component
 * de fato montou (não só o shell).
 */

const ROUTES: { path: string; expectText: RegExp }[] = [
  { path: '/', expectText: /Plina/i },
  { path: '/pool', expectText: /pool|NAV/i },
  { path: '/cotas', expectText: /cota/i },
  { path: '/politica-clawback', expectText: /clawback/i },
  { path: '/investir', expectText: /Acesso institucional|Investir|PLINA-RF/i },
  { path: '/sacar', expectText: /Sacar|TESOURO|PIX/i },
  { path: '/vender', expectText: /vender|cota|contemplad/i },
  { path: '/comprar', expectText: /comprar|cota|contemplad/i },
  { path: '/minha-posicao', expectText: /posi[çc][ãa]o|institucional|Plina/i },
];

for (const { path, expectText } of ROUTES) {
  test(`renderiza ${path}`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), `status de ${path}`).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(expectText);
  });
}

test('stellar.toml é servido com CORS, PLINARF, PRINCIPALS e SEPs planejados', async ({
  request,
}) => {
  const res = await request.get('/.well-known/stellar.toml');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/PLINARF/);
  expect(body).toMatch(/ORG_OFFICIAL_EMAIL = "contato@plina\.finance"/);
  expect(body).toMatch(/ORG_LOGO/);
  expect(body).toMatch(/\[\[PRINCIPALS\]\]/);
  expect(body).toMatch(/Thais Reis/);
  expect(body).toMatch(/Fabricio Santos/);
  // SEPs documentados como comentário (Fase 1)
  expect(body).toMatch(/SEP-6|SEP-10|SEP-38/);
  expect(res.headers()['access-control-allow-origin']).toBeTruthy();
});
