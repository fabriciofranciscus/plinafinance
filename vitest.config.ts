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
  },
});
