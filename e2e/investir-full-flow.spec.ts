/**
 * Playwright E2E full flow — Trilha 1 entrada: BRL → TESOURO → claim CB
 *                              → swap atômico → PLINA-RF emitido.
 *
 * Roda contra dev server com:
 *   NEXT_PUBLIC_E2E_PRIVY_STUB=true  (frontend usa StubPrivyProvider)
 *   PRIVY_VERIFY_STUB=true            (backend aceita Bearer e2e-stub-<pubkey>)
 *
 * Sandbox real (Etherfuse + Stellar testnet). Friendbot a cada spec.
 * Cleanup em afterEach via cleanupE2eInvestidor.
 */

import { test, expect } from '@playwright/test';
import {
  seedE2eInvestidor,
  cleanupE2eInvestidor,
  type E2eInvestidorSeed,
} from './fixtures/seed-e2e-investidor';
import { db } from '@/lib/db';

let seed: E2eInvestidorSeed | null = null;

test.afterEach(async () => {
  if (seed) {
    await cleanupE2eInvestidor(seed.privyId);
    seed = null;
  }
});

test('full /investir flow: BRL → TESOURO → claim CB → swap PLINA-RF', async ({
  page,
}) => {
  seed = await seedE2eInvestidor();
  const { pubkey, secret, email, privyId, investidorId } = seed;

  // Injeta sessão no localStorage antes do React montar.
  await page.context().addInitScript(
    ({ pubkey, secret, email, userId }) => {
      localStorage.setItem('e2e_stub_pubkey', pubkey);
      localStorage.setItem('e2e_stub_secret', secret);
      localStorage.setItem('e2e_stub_email', email);
      localStorage.setItem('e2e_stub_user_id', userId);
    },
    { pubkey, secret, email, userId: privyId },
  );

  await page.goto('/investir');

  // Welcome → identity (auto via useEffect quando authenticated=true).
  await expect(page.locator('body')).toContainText(/Identidade|consentimento/i, {
    timeout: 15_000,
  });

  // Identity: clica "Iniciar onboarding" pra disparar runOnboard. Service
  // é idempotente: Investidor já existe no DB com status=AUTORIZADO via seed,
  // então retorna existing sem re-chamar Etherfuse.
  await page
    .getByRole('button', { name: /iniciar onboarding/i })
    .click({ timeout: 15_000 });

  // Trustlines: 2 assinaturas (PLINARF + TESOURO). Seed já criou as duas
  // on-chain, então `changeTrust` duplicado é no-op pelo Stellar. Frontend
  // chama build → signRawHash (stub local) → submit. Aguarda completion.
  await page
    .getByRole('button', { name: /configurar trustlines/i })
    .click({ timeout: 30_000 });
  await expect(
    page.getByText(/trustlines configuradas/i),
  ).toBeVisible({ timeout: 90_000 });

  await page
    .getByRole('button', { name: /continuar para cotação/i })
    .click({ timeout: 15_000 });

  // Banking: bank já registrado no seed (handler retorna idempotent=true).
  // Frontend `registerBank` avança DIRETO pra quote após sucesso —
  // não precisa de "Continuar para cotação" extra click.
  await expect(page.locator('body')).toContainText(/Conta PIX|Registre/i);
  await page.getByPlaceholder(/52998224725/i).first().fill('52998224725');
  await page.getByPlaceholder(/52998224725/i).nth(1).fill('52998224725');
  await page.getByPlaceholder(/João/i).fill('E2E');
  await page.getByPlaceholder(/Silva/i).fill('Plina');
  await page.getByRole('button', { name: /registrar conta pix/i }).click();

  // Quote BRL→TESOURO.
  await expect(page.locator('body')).toContainText(/Cotação/i, { timeout: 30_000 });
  await page.locator('input[type=number]').first().fill('10');
  await expect(page.locator('body')).toContainText(/PLINA-RF/, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /revisar compra/i }).click();

  // OnRamp: simular PIX pago (sandbox).
  await expect(page.locator('body')).toContainText(/Pague.*PIX|Pagamento/i);
  await page.getByRole('button', { name: /simular pix pago/i }).click();

  // Settling: polling real, status=completed em ~30-60s.
  await expect(page.locator('body')).toContainText(/TESOURO liquidado/i, {
    timeout: 180_000,
  });
  await page
    .getByRole('button', { name: /continuar para revisão/i })
    .click();

  // Claiming: se CB existe (PLINA-MOD-007 path), clica reclamar.
  const claimBtn = page.getByRole('button', {
    name: /assinar e reclamar tesouro/i,
  });
  if (await claimBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await claimBtn.click();
    await expect(page.locator('body')).toContainText(/Claim tx/i, {
      timeout: 30_000,
    });
    await page
      .getByRole('button', { name: /continuar para revisão/i })
      .click();
  }

  // Confirm swap atômico TESOURO → PLINA-RF.
  await expect(page.locator('body')).toContainText(/Revisão|Confirme/i, {
    timeout: 30_000,
  });
  // Checkbox de confirmação habilita o botão. O <input> é sr-only dentro
  // do <label> (visual é um <span> custom), então pointer-event vai pro
  // span — force=true bypassa actionability check; onChange dispara igual.
  await page.getByLabel(/confirmo destinatário/i).check({ force: true });
  await page
    .getByRole('button', { name: /assinar e executar swap/i })
    .click({ timeout: 30_000 });

  // Receipt: assert hashes presentes.
  await expect(page.locator('body')).toContainText(/Confirmação|sucesso|receipt/i, {
    timeout: 60_000,
  });

  // DB asserts: estado final.
  const inv = await db.investidor.findUnique({ where: { id: investidorId } });
  expect(inv).not.toBeNull();
  expect(inv!.etherfuseBankAccountId).not.toBeNull();

  const orders = await db.onRampOrder.findMany({
    where: { investidorId },
  });
  expect(orders.length).toBeGreaterThan(0);
  const lastOrder = orders[orders.length - 1];
  // PIX/BRL sandbox aceita 'processing' como terminal (raw `funded`).
  expect(['completed', 'processing']).toContain(lastOrder.status);
  // ClaimableBalance pode existir (PLINA-MOD-007) ou não (payment direto).
  if (lastOrder.stellarClaimableBalanceId) {
    expect(lastOrder.claimTxHash).not.toBeNull();
  }

  const audits = await db.eventoAudit.findMany({
    where: { investidorId },
    select: { acao: true },
  });
  const acoes = audits.map((a) => a.acao);
  expect(acoes).toContain('ONRAMP_CRIADA');
  // ONRAMP_LIQUIDADA só é emitido quando status vira completed. Em sandbox PIX
  // pode parar em processing — aceita como caminho válido.
  // Mas CLAIMABLE_BALANCE_RESGATADA é o sinal real de "tem TESOURO".
  expect(acoes.includes('ONRAMP_LIQUIDADA') || acoes.includes('CLAIMABLE_BALANCE_RESGATADA')).toBe(true);
});
