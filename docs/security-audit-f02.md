# Security Audit · F-02 — Auth-guard em /api/investidor/**

**Status:** fechado em 2026-05-21 · **PRs:** #10 → #16 (stack) · **Severidade original:** CRÍTICO

---

## Resumo

Auditoria de segurança identificou que 12 rotas em `app/api/investidor/**` aceitavam requisições anônimas, dependendo apenas de comparação de IDs do body com o DB pra identificar o investidor. Defesa do tipo "compara `customerId`/`quoteId`/`pubkey` com DB" é **IDOR clássico** (OWASP A01/A07) — qualquer UUID vazado em log/clipboard/screenshot vira exploit.

**Impactos concretos antes do fix:**

| Vetor | Onde | Exploit |
|---|---|---|
| Vazamento de PIX | `/onramp/status` | `orderId` em link/log → atacante lê chave PIX + beneficiário + valor pra phishing-substituição |
| Order em nome alheio | `/onramp/create` | `quoteId` vazado → cria ordem cobrada da vítima, audit log sem dono |
| Emissão indevida (mock) | `/swap/build` | Em sandbox/PLINA-MOD-005, `quoteId` + `publicKey` → `distribute()` na wallet alheia em testnet |
| IDOR via body | submits | `investidorId?` opcional silenciava audit e permitia spoof |
| Fallback por pubkey | `/trust-tesouro/submit` | `findUnique({ publicKey })` resolvia wallet de outro investidor |
| Sem identidade de sessão | todos os audit logs | CVM 175 exige rastreabilidade individual — não dava pra responder "qual sessão clicou" |

**Causa raiz:** ausência de middleware/wrapper de auth + modelo de confiança centrado em validação on-chain pelo Horizon, deixando estado off-chain (DB, Etherfuse, audit) sem dono.

---

## Solução — 6 PRs stacked

```
onboarding-doc
└─ #10 chore/add-vitest                              (test runner)
   └─ #11 fix/auth-guard-helper                      (helper + schema)
      └─ #12 fix/auth-guard-read-routes              (read routes)
         └─ #13 fix/auth-guard-onramp                (onramp)
            └─ #14 fix/auth-guard-swap               (swap — caminho crítico)
               └─ #15 fix/auth-guard-trust-liquidar  (trust+liquidar, fecha F-05)
                  └─ #16 fix/audit-privy-id-and-lint (CVM 175 + lint guard)
```

### #10 — Vitest runner

Sem unit-test runner antes (só Playwright + smoke scripts). Adiciona Vitest 4 com `resolve.tsconfigPaths: true` nativo, env `node`, convenção `__tests__/<espelho-do-src>/`. Desbloqueia testes pros PRs seguintes.

Scripts: `pnpm test`, `pnpm test:watch`.

### #11 — Helper + schema

Cria `lib/wallet/auth-guard.ts` com:
- `requireInvestidor(req)` — extrai Bearer token, valida via `privy.verifyAuthToken`, resolve `Investidor` por `privyId`. Lança `AuthError` 401/403.
- `withAuth(handler)` — wrapper que converte `AuthError` em `NextResponse.json({error}, {status})`.
- `AuthedInvestidor { privyId, investidorId, publicKey, email, etherfuseCustomerId }`.

Schema: `Investidor.privyId String? @unique` (chave estável; antes era email). `lib/services/investidor.ts:onboardInvestidor` persiste no upsert + backfill in-line.

Script `scripts/backfill-privy-id.ts` (`--apply`) pra rows antigas via `privy.getUserByEmail`.

**Risco zero** — helper criado mas nenhuma rota usa ainda.

### #12 — Read routes

Aplica `withAuth` em 3 rotas de menor risco:
- `POST /api/investidor/quote` — 403 se `customerId ≠ user.etherfuseCustomerId` ou `stellarAddress ≠ user.publicKey`. Drop do lookup por `customerId`.
- `GET /api/investidor/buy/onramp/status` — 403 se `order.investidorId !== user.investidorId`. **Fecha F-03 (vazamento de PIX).**
- `GET /api/investidor/events` — drop do round-trip `privy.getUserById` + email lookup. Resolve direto por `user.investidorId`.

Frontend: Authorization adicionado em 2 fetches de `/investir`. `minha-posicao` já enviava.

### #13 — Onramp

- `POST /api/investidor/buy/onramp/create` — 403 se `quote.investidorId !== user.investidorId`. Fecha F-02 §4.2 (criação em nome alheio).
- `POST /api/investidor/buy/onramp/sandbox-pay` — 403 se `order.investidorId !== user.investidorId`. Ordem nova: **auth → env check → ownership**.

Idempotência preservada (order existente, completed-status flow).

### #14 — Swap (caminho crítico)

- `POST /api/investidor/buy/swap/build` — 403 se `investorPubkey ≠ user.publicKey` ou `quote.investidorId ≠ user.investidorId`. Drop do check redundante `quote.investidor.publicKey === investorPubkey`. **Mock path fica protegido por ownership automático — fecha o exploit de emissão indevida em testnet.**
- `POST /api/investidor/buy/swap/submit` — mesmo padrão.

Comportamento Stellar/Etherfuse intacto: `buildSwapBridgeForPlinarfXdr`, `preSignWithSecret`, `distribute`, `submitWithPrivySignature` não tocados. Auth é gate prévio.

**Exige smoke testnet + E2E manual antes do merge.**

### #15 — Trust + Liquidar (fecha F-05 IDOR)

6 rotas: `trust-plinarf/{build,submit}`, `trust-tesouro/{build,submit}`, `liquidar/{quote,submit}`. Todas com `withAuth` + 403 se `pubkey ≠ user.publicKey`.

**Drops importantes:**
- `investidorId?` opcional do body removido em todos os submits → sempre `user.investidorId`. Fecha **F-05**.
- `trust-tesouro/submit` perde fallback `findUnique({ publicKey: investorPubkey })` — wallet alheia não resolve mais.
- `lib/services/liquidacao.ts:submitLiquidacao` muda `investidorId?` → `investidorId: string` required. Audit `PLINARF_LIQUIDADO` agora **sempre grava** (antes era condicional ao body).

### #16 — EventoAudit.privyId + lint guard

**Schema:**
- `EventoAudit.privyId String?` (nullable) + `@@index([privyId])`. Rastreabilidade individual CVM 175.
- Migration `20260521190948_add_evento_audit_privy_id`.

**9 audit-creates populam `user.privyId`:** 7 rotas + `lib/services/investidor.ts:onboardInvestidor` (eleva do `payloadJson` pra coluna) + `lib/services/liquidacao.ts:submitLiquidacao` (assinatura ganha `privyId: string` required).

**Lint:**
- `scripts/lint/require-auth-guard.mjs` — glob recursivo em `app/api/investidor/**/route.ts`, exige import literal de `@/lib/wallet/auth-guard`. Allowlist: `['onboard']`.
- `package.json`: `lint:auth-guard` + **`prebuild` gate** — bloqueia deploy Vercel se regressão entrar.

---

## Estado final

| Métrica | Antes | Depois |
|---|---|---|
| Rotas `app/api/investidor/**` sem auth | 12 | **0** |
| IDOR via `investidorId?` no body | aberto | **F-05 fechado** |
| Mock-path swap autenticado | não | **sim** |
| Vazamento PIX via `/onramp/status` | aberto | **F-03 fechado** |
| `EventoAudit` com identidade de sessão | não | **CVM 175 OK** |
| Lint contra regressão | nenhum | `prebuild` gate |
| Testes unitários | 0 | **60** |

## Comandos de verificação

```bash
# 1. Lint (roda em prebuild):
pnpm lint:auth-guard
# ✓ app/api/investidor: 13 rota(s) verificada(s), todas usam auth-guard.

# 2. Unit tests:
pnpm test
# Tests  60 passed (15 files)

# 3. Typecheck:
pnpm typecheck
# Só pré-existentes em .next/types/validator.ts (route stub legado)

# 4. Smoke testnet (necessário antes de mergear PR 4 e PR 5):
pnpm smoke:etherfuse

# 5. E2E manual no dev server (:3002):
pnpm dev
# Login Privy → /investir → fluxo completo → /minha-posicao → liquidar
# Confirmar txHash no Stellar Expert + privyId em EventoAudit via Prisma Studio

# 6. Curl de regressão (sem token):
curl -i -X POST http://localhost:3002/api/investidor/quote \
  -H 'content-type: application/json' \
  -d '{"amountBrl":"100","customerId":"x","stellarAddress":"GA"}'
# Esperado: HTTP 401
```

## Ordem de merge

1. **#10** → `onboarding-doc`
2. **#11** → automaticamente retarget após #10
3. **#12 → #13 → #14 → #15 → #16** — em sequência
4. **#14 e #15 exigem smoke testnet + E2E manual** antes do merge (caminho de emissão e liquidação).

Após cada merge upstream, GitHub retargeta o próximo PR.

## Próximos fixes do audit original (fora do escopo F-02)

Cada um vira plano próprio:

| ID | Severidade | Tema |
|---|---|---|
| F-01 | Alto (local) | Rotação dos segredos em `.env`/`.env.local` |
| F-04 | Alto | Admin auth (Clerk/Auth.js, drop do `ADMIN_PASSWORD` single-shared) |
| F-06 | Alto | MAC server-side sobre `distributorSigBase64` |
| F-07 | Alto | Reconciliação onramp→swap (job de detecção de fundos presos) |
| F-09 | Médio | Race em `distribute()` mock fora da `$transaction` |
| F-12 | Médio | Validação explícita da sig do investidor pré-Horizon |
| F-16 | Médio | Drop do KYC dummy (`CPF 52998224725` + dummy PNG) — bloqueador de mainnet |
| F-20 | Médio | Migrar `STELLAR_ISSUER_SECRET` / `STELLAR_DISTRIBUTOR_SECRET` pra KMS antes da mainnet |
| F-24 | Médio | Rate limiting por `privyId` (Vercel KV / Upstash) |
| F-27 | Baixo | Stub `app/api/investidor/liquidar/build/route.ts` ausente (frontend chama, 404) |
