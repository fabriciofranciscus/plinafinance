import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — e2e em testnet.
 *
 * Convenções:
 *   - Tests vivem em `e2e/`.
 *   - Reaproveita dev server local (`npm run dev`) se não estiver rodando.
 *   - Sequential workers (workers=1) pra evitar race em DB Neon compartilhado.
 *   - Fluxos que dependem de Privy (assinatura wallet investidor) NÃO são
 *     cobertos por enquanto — exigem stub do flow OTP. Cobertos:
 *       · superfícies públicas (smoke render)
 *       · onboarding vendedor (lead + simular)
 *       · onboarding comprador (lead)
 *       · /api/investidor/liquidar/quote (não exige Privy session)
 *       · politica-clawback + stellar.toml linkados
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
