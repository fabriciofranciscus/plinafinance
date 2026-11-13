import { expect, test } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * E2-3 — entrada do investidor no produto, tela de identidade (rede mockada).
 *
 *  - a verificação por organização chega por webhook: com KYC pendente a tela
 *    avisa, relê o onboard sozinha e só libera a cotação depois de aprovada;
 *  - o TESOURO não ganha trustline antes do claim (o claim a abre, patrocinada
 *    pelo anchor): só PLINARF e PLINARFB são assinadas, 2 assinaturas.
 *
 * O claim com changeTrust e a regeneração de XDR estão em vitest
 * (use-claim.test.tsx); o fluxo real, com Etherfuse e testnet, é o da Vera.
 * Roda no project e2e-stub: E2E_STUB=1 pnpm exec playwright test --project=e2e-stub
 */

const kp = Keypair.random();
const HASH = `0x${'ab'.repeat(32)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ pubkey, secret }) => {
      localStorage.setItem('e2e_stub_pubkey', pubkey);
      localStorage.setItem('e2e_stub_secret', secret);
    },
    { pubkey: kp.publicKey(), secret: kp.secret() },
  );
});

test('KYC pendente atualiza sozinho; trustline do TESOURO não é pedida', async ({
  page,
}) => {
  let onboardCalls = 0;
  const urls: string[] = [];

  await page.route('**/api/investidor/onboard', async (route) => {
    onboardCalls += 1;
    const approved = onboardCalls >= 3; // webhook chega na 2ª releitura
    await route.fulfill({
      json: {
        data: {
          investidorId: 'inv-e2e',
          publicKey: kp.publicKey(),
          etherfuseCustomerId: 'cust-e2e-0001',
          kycStatus: approved ? 'approved' : 'pending',
          fundedNow: false,
          trustlinesReady: false,
        },
        error: null,
      },
    });
  });
  await page.route('**/api/investidor/buy/trust-*/*', async (route) => {
    const url = route.request().url();
    urls.push(new URL(url).pathname);
    if (url.endsWith('/build')) {
      return route.fulfill({ json: { data: { xdr: 'AAAA', hashHex: HASH }, error: null } });
    }
    return route.fulfill({ json: { data: { ok: true }, error: null } });
  });
  await page.route('**/api/investidor/entidade', (route) => route.fulfill({ json: { data: {}, error: null } }));

  await page.goto('/investir');
  await page.getByRole('button', { name: /iniciar onboarding/i }).click();

  // KYC pendente: aviso visível e a cotação continua bloqueada.
  const pendente = page.getByTestId('kyc-pending');
  await expect(pendente).toContainText('Aguardando a confirmação da anchor');

  await page.getByRole('button', { name: /configurar trustlines/i }).click();
  await expect(page.getByText('trustlines configuradas')).toBeVisible();
  const continuar = page.getByRole('button', { name: /continuar para cotação/i });
  await expect(continuar).toBeDisabled();

  // Dados da entidade (a cotação também exige): preenchidos já aqui.
  await page.getByPlaceholder('Família Investimentos LTDA').fill('Entidade de Teste LTDA');
  await page.getByPlaceholder('00.000.000/0001-00').fill('11.222.333/0001-81');

  // O webhook chega: a tela atualiza sozinha (releitura a cada 5 s) e libera.
  await expect(page.getByText('● aprovado')).toBeVisible({ timeout: 20_000 });
  await expect(pendente).toHaveCount(0);
  await expect(continuar).toBeEnabled();

  // Só as duas trustlines PLINA-RF; nenhuma do TESOURO.
  expect(urls).toEqual([
    '/api/investidor/buy/trust-plinarf/build',
    '/api/investidor/buy/trust-plinarf/submit',
    '/api/investidor/buy/trust-plinarf/build',
    '/api/investidor/buy/trust-plinarf/submit',
  ]);
  expect(onboardCalls).toBeGreaterThanOrEqual(3);
});
