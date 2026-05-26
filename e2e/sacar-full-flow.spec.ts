/**
 * Playwright E2E full flow — Trilha 1 saída: TESOURO → BRL via PIX.
 *
 * Pré-req: Investidor com saldo TESOURO > 0 na trustline. Spec prime
 * o saldo via on-ramp completo + claim CB ANTES de chegar na UI.
 *
 * Stub mode (mesmo de investir-full-flow):
 *   NEXT_PUBLIC_E2E_PRIVY_STUB=true + PRIVY_VERIFY_STUB=true
 */

import { test, expect } from '@playwright/test';
import {
  seedE2eInvestidor,
  cleanupE2eInvestidor,
  type E2eInvestidorSeed,
} from './fixtures/seed-e2e-investidor';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import {
  buildClaimClaimableBalanceXdr,
} from '@/lib/stellar/transactions';
import { horizon, getAssetBalance } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import { Keypair, Transaction } from '@stellar/stellar-sdk';

let seed: E2eInvestidorSeed | null = null;

/**
 * Faz on-ramp completo programaticamente pra colocar TESOURO na wallet
 * antes do spec UI rodar. Espelha smoke steps 8-12.
 */
async function primeTesouroBalance(seed: E2eInvestidorSeed): Promise<void> {
  const anchor = new EtherfuseClient({
    apiKey: process.env.ETHERFUSE_API_KEY!,
    baseUrl:
      process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });
  const kp = Keypair.fromSecret(seed.secret);

  const quote = await anchor.getQuote({
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: '100',
    customerId: seed.etherfuseCustomerId,
    stellarAddress: seed.pubkey,
  });
  await db.quote.create({
    data: {
      id: quote.id,
      investidorId: seed.investidorId,
      fromCurrency: 'BRL',
      fromAmount: quote.fromAmount,
      toCurrency: 'TESOURO',
      toAmount: quote.toAmount,
      exchangeRate: quote.exchangeRate,
      fee: quote.fee,
      expiresAt: new Date(quote.expiresAt),
    },
  });

  const order = await anchor.createOnRamp({
    customerId: seed.etherfuseCustomerId,
    quoteId: quote.id,
    stellarAddress: seed.pubkey,
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    amount: '100',
    bankAccountId: seed.etherfuseBankAccountId,
  });
  await db.onRampOrder.create({
    data: {
      id: order.id,
      quoteId: quote.id,
      investidorId: seed.investidorId,
      status: order.status,
      paymentInstructionsJson: order.paymentInstructions
        ? JSON.parse(JSON.stringify(order.paymentInstructions))
        : null,
    },
  });

  await anchor.simulateFiatReceived(order.id);
  // Polling manual até anchor emitir CB OU status virar completed. PIX/BRL
  // sandbox às vezes para em `funded` (= processing) mas a CB chega depois
  // de alguns segundos. Tolerância 13min — smoke vê CB em ~30s, sandbox
  // flap pode estender até alguns min.
  const deadline = Date.now() + 780_000;
  let cbId: string | null = null;
  let finalStatus = 'pending';
  while (Date.now() < deadline) {
    const tx = await anchor.getOnRampTransaction(order.id);
    if (tx) {
      finalStatus = tx.status;
      if (tx.stellarClaimableBalanceId) {
        cbId = tx.stellarClaimableBalanceId;
        break;
      }
      if (tx.status === 'completed') {
        // anchor pode ter pago via payment direto (sem CB) — sair do loop.
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  await db.onRampOrder.update({
    where: { id: order.id },
    data: {
      status: finalStatus,
      stellarClaimableBalanceId: cbId,
      settledAt: new Date(),
    },
  });

  // Claim CB (PLINA-MOD-007). Sem isso TESOURO não vai pra trustline,
  // off-ramp burn falha com op_underfunded.
  if (cbId) {
    const { xdr } = await buildClaimClaimableBalanceXdr({
      investorPubkey: seed.pubkey,
      balanceId: cbId,
    });
    const tx = new Transaction(xdr, networkPassphrase);
    tx.sign(kp);
    const claimRes = await horizon.submitTransaction(tx);
    await db.onRampOrder.update({
      where: { id: order.id },
      data: { claimTxHash: claimRes.hash },
    });
  }

  // Verifica saldo > 0 antes de continuar (defesa contra op_underfunded).
  const tesouro = await resolveTesouroAsset(seed.pubkey);
  let attempts = 0;
  while (attempts < 24) {
    const balance = await getAssetBalance(seed.pubkey, tesouro.code, tesouro.issuer);
    if (Number(balance) > 0) return;
    await new Promise((r) => setTimeout(r, 5_000));
    attempts += 1;
  }
  throw new Error(
    `primeTesouroBalance: saldo TESOURO=0 após ${attempts * 5}s. cbId=${cbId}, status=${finalStatus}. Sandbox PIX/BRL pode estar flap — retry.`,
  );
}

test.afterEach(async () => {
  if (seed) {
    await cleanupE2eInvestidor(seed.privyId);
    seed = null;
  }
});

test('full /sacar flow: TESOURO → BRL → processing', async ({ page }) => {
  seed = await seedE2eInvestidor();
  await primeTesouroBalance(seed);

  const { pubkey, secret, email, privyId, investidorId } = seed;

  await page.context().addInitScript(
    ({ pubkey, secret, email, userId }) => {
      localStorage.setItem('e2e_stub_pubkey', pubkey);
      localStorage.setItem('e2e_stub_secret', secret);
      localStorage.setItem('e2e_stub_email', email);
      localStorage.setItem('e2e_stub_user_id', userId);
    },
    { pubkey, secret, email, userId: privyId },
  );

  await page.goto('/sacar');

  // Quote TESOURO → BRL.
  await expect(page.locator('body')).toContainText(/Cotação TESOURO/i, {
    timeout: 15_000,
  });
  await page.locator('input[type=number]').first().fill('5');
  await expect(page.locator('body')).toContainText(/Receberá/i, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /criar order de saque/i }).click();

  // Signing: clica assinar burn.
  await expect(page.locator('body')).toContainText(/Assine o burn/i, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /assinar burn e submeter/i }).click();

  // Processing/done: aguarda status processing (Etherfuse upstream `funded`).
  await expect(page.locator('body')).toContainText(/processing/i, {
    timeout: 180_000,
  });

  // DB assert: OffRampOrder em processing + burnStellarTxHash set.
  const offRamps = await db.offRampOrder.findMany({
    where: { investidorId },
  });
  expect(offRamps.length).toBeGreaterThan(0);
  const last = offRamps[offRamps.length - 1];
  expect(['processing', 'completed', 'submitted']).toContain(last.status);
  expect(last.burnStellarTxHash).not.toBeNull();
  expect(last.burnStellarTxHash).not.toMatch(/^mock-/);

  // Audit asserts.
  const audits = await db.eventoAudit.findMany({
    where: { investidorId, acao: { in: ['OFFRAMP_CRIADA', 'OFFRAMP_BURN_ASSINADO'] } },
    select: { acao: true },
  });
  const acoes = audits.map((a) => a.acao);
  expect(acoes).toContain('OFFRAMP_CRIADA');
  expect(acoes).toContain('OFFRAMP_BURN_ASSINADO');
});
