import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — e2e em testnet.
 *
 * Convenções:
 *   - Tests vivem em `e2e/`.
 *   - Reaproveita dev server local (`npm run dev`) se não estiver rodando.
 *   - Sequential workers (workers=1) pra evitar race em DB Neon compartilhado.
 *
 * Dois modos:
 *
 *   1. **Default** (`npm run test:e2e`): contratuais + render smoke + APIs
 *      públicas. Não requer Privy. `full-flow.spec.ts` é ignorado.
 *
 *   2. **Stub** (`E2E_STUB=1 npm run test:e2e:stub`): roda dev server com
 *      `NEXT_PUBLIC_E2E_PRIVY_STUB=true` + `PRIVY_VERIFY_STUB=true`. Specs
 *      `*-full-flow.spec.ts` clicam pelo flow inteiro com keypair Stellar
 *      seedado por spec via Friendbot + Etherfuse sandbox real.
 */

const STUB_MODE = process.env.E2E_STUB === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: STUB_MODE ? 15 * 60 * 1000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // Stub specs tocam Etherfuse sandbox + Stellar testnet reais — flap-prone.
  // 2 retries cobrem latência transitória upstream. Specs contratuais não
  // precisam.
  retries: STUB_MODE ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Specs *-full-flow (UI completo, Friendbot + Etherfuse) e *-authed
      // (handlers autenticados via seed leve + Privy stub) exigem
      // PRIVY_VERIFY_STUB — só rodam no project `e2e-stub`.
      testIgnore: /-(full-flow|authed)\.spec\.ts$/,
    },
    {
      name: 'e2e-stub',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /-(full-flow|authed)\.spec\.ts$/,
    },
  ],
  webServer: {
    command: STUB_MODE
      ? 'NEXT_PUBLIC_E2E_PRIVY_STUB=true PRIVY_VERIFY_STUB=true npm run dev'
      : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !STUB_MODE,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
