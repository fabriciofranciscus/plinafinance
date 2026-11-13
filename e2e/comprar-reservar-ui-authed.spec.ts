import { expect, test } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * E1-3-ui — /comprar/reservar chama a rota única POST /api/comprar/reserva.
 *
 * A rota é mockada (o contrato da API é coberto por __tests__/api/comprar e
 * e2e/originacao-api.spec.ts); aqui vale o wiring da página: 1 clique = 1
 * chamada, na rota nova, nunca em /api/comprar/reservar. Precisa do stub do
 * Privy (project e2e-stub, E2E_STUB=1).
 */

const kp = Keypair.random();
const TX_HASH = 'a'.repeat(64);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ pubkey, secret }) => {
      localStorage.setItem('e2e_stub_pubkey', pubkey);
      localStorage.setItem('e2e_stub_secret', secret);
    },
    { pubkey: kp.publicKey(), secret: kp.secret() },
  );
});

test('confirmar reserva faz uma chamada em /api/comprar/reserva', async ({
  page,
}) => {
  const reservaCalls: { auth: string | undefined; body: unknown }[] = [];
  const legacyCalls: string[] = [];

  await page.route('**/api/comprar/reservar', (route) => {
    legacyCalls.push(route.request().url());
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/api/comprar/reserva', (route) => {
    const req = route.request();
    reservaCalls.push({
      auth: req.headers()['authorization'],
      body: req.postDataJSON(),
    });
    return route.fulfill({
      json: {
        reservaId: 'res_e2e_1',
        expiraEm: '2026-11-12T12:00:00.000Z',
        txHash: TX_HASH,
        payloadHash: 'b'.repeat(64),
      },
    });
  });

  await page.goto('/comprar/reservar?cotaId=cota_e2e_1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /confirmar reserva/i }).click();

  await expect(page.getByText('Cota travada pra você.')).toBeVisible();
  await expect(page.getByText('Reserva: res_e2e_1')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /ver no stellar expert/i }),
  ).toHaveAttribute('href', new RegExp(TX_HASH));

  expect(reservaCalls).toHaveLength(1);
  expect(reservaCalls[0].body).toEqual({ cotaId: 'cota_e2e_1' });
  expect(reservaCalls[0].auth).toBe(`Bearer e2e-stub-${kp.publicKey()}`);
  expect(legacyCalls).toHaveLength(0);
});

test('erro 409 da rota aparece na tela e não cria reserva', async ({ page }) => {
  await page.route('**/api/comprar/reserva', (route) =>
    route.fulfill({ status: 409, json: { error: 'Cota não reservável' } }),
  );
  await page.goto('/comprar/reservar?cotaId=cota_e2e_2');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /confirmar reserva/i }).click();

  await expect(page.getByText(/não reservável/i)).toBeVisible();
  await expect(page.getByText('Cota travada pra você.')).toHaveCount(0);
});
