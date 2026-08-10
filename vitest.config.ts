import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'app/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'tests/**',
      'playwright-report/**',
      'test-results/**',
    ],
    clearMocks: true,
    restoreMocks: true,
    // Os testes de Stellar (build/hash/assinatura de XDR) fazem cripto pesada.
    // Isolados rodam em ~2s, mas disputando CPU com os outros workers passavam
    // dos 5s do default e falhavam de forma intermitente — não era bug de
    // código, era o timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
