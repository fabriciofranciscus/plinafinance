import { defineConfig } from 'vitest/config';

const comum = {
  environment: 'node' as const,
  clearMocks: true,
  restoreMocks: true,
  // Os testes de Stellar (build/hash/assinatura de XDR) fazem cripto pesada.
  // Isolados rodam em ~2s, mas disputando CPU com os outros workers passavam
  // dos 5s do default e falhavam de forma intermitente — não era bug de
  // código, era o timeout.
  testTimeout: 30_000,
  hookTimeout: 30_000,
};
const exclude = ['node_modules/**', '.next/**', 'tests/**', 'playwright-report/**', 'test-results/**'];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Os testes com Postgres REAL (`*-pg.test.ts`, opt-in por TEST_PG_URL) compartilham UM banco e fazem
    // TRUNCATE ... CASCADE no início de cada caso. Em paralelo, um arquivo apaga as linhas do outro e os
    // testes quebram de forma intermitente (visto ao unir E1-4 e N1). Por isso rodam num projeto próprio,
    // um arquivo por vez; o resto da suíte segue em paralelo. Todo teste novo de banco real deve terminar
    // em `-pg.test.ts`.
    projects: [
      {
        extends: true,
        test: {
          ...comum,
          name: 'unit',
          include: ['__tests__/**/*.test.ts', 'app/**/__tests__/**/*.test.{ts,tsx}'],
          exclude: [...exclude, '**/*-pg.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          ...comum,
          name: 'pg',
          include: ['__tests__/**/*-pg.test.ts'],
          exclude,
          fileParallelism: false,
        },
      },
    ],
  },
});
