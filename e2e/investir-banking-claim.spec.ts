import { expect, test } from '@playwright/test';

/**
 * Smoke render dos novos screens no /investir + /sacar (PLINA-MOD-006 + 007).
 *
 * Sem login Privy, ambos param na tela de welcome/login. O spec garante:
 *   1. Rotas respondem 200.
 *   2. Markers da página estão presentes (não é shell vazio).
 *
 * Cobertura real do flow (form bank + claim sign) depende de Privy session
 * real, que está fora de escopo do contractual.
 */

test('renderiza /investir e mostra welcome', async ({ page }) => {
  const res = await page.goto('/investir', { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(
    /Acesso institucional|Investir|PLINA-RF/i,
  );
});

test('renderiza /sacar e mostra prompt de login', async ({ page }) => {
  const res = await page.goto('/sacar', { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBeLessThan(400);
  // Sem Privy session, mostra prompt de login.
  await expect(page.locator('body')).toContainText(
    /Sacar BRL|TESOURO|PIX/i,
  );
});
