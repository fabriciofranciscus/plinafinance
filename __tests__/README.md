# Unit tests

Runner: **Vitest**. Roda em Node, sem DB nem rede.

## Comandos

```bash
pnpm test          # single-shot (CI)
pnpm test:watch    # watch mode (DX)
```

E2E (Playwright) e smoke (testnet/sandbox) continuam separados:

```bash
pnpm test:e2e
pnpm smoke:etherfuse
pnpm smoke:stellar
```

## Convenção

- Arquivos `*.test.ts` em `__tests__/<espelho-do-src>/`.
  - Ex.: `lib/wallet/auth-guard.ts` → `__tests__/lib/wallet/auth-guard.test.ts`.
- **Sem DB real, sem Privy real.** Mocke o singleton em `@/lib/db` e `@/lib/wallet/privy` com `vi.mock`.
- Para componente React: adicionar `// @vitest-environment jsdom` no topo do arquivo e instalar `@testing-library/react` localmente.

## Padrão de mock

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { investidor: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/wallet/privy', () => ({
  getPrivyClient: vi.fn(),
}));

// importar o SUT depois dos vi.mock pra eles fazerem efeito
import { requireInvestidor } from '@/lib/wallet/auth-guard';
```

## O que cobrir aqui

- Lógica pura em `lib/services/**`, `lib/anchors/**`, `lib/stellar/**`.
- Helpers de auth, validação, formatação.

## O que NÃO cobrir aqui

- Chamadas reais a Stellar/Etherfuse → `scripts/smoke-*.ts`.
- Fluxo de browser → `tests/` (Playwright).
- Migrations Prisma → `scripts/smoke-audit.ts` e revisão manual.
