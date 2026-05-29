# PRD v1.0 — Readiness Assessment

**Data:** 2026-05-27 · **Branch:** `refactor/investir-decompose-and-tests`
**Fonte:** `docs/PRD-plina-v1.md` (v1.0, 2026-05-25) · **Plano original:** `~/.claude/plans/pode-seguir-com-as-jazzy-teacup.md`

## Veredito

A base está pronta para iniciar **M0 e M1 em paralelo**. Os gaps são todos
*aditivos* (novos modelos, novas pastas, novas integrações), não estruturais —
nenhum refactor bloqueante.

## ✅ Pronto

- Next.js 16 App Router + Prisma + Neon Postgres.
- `withAuth` em `/api/investidor/**` + lint enforce.
- Privy auth + stub mode (e2e).
- Etherfuse SEP-12/24/38 em `lib/anchors/etherfuse/`.
- Stellar SDK + audit memo-hash + parse XDR.
- 31 modelos/enums em `prisma/schema.prisma`: Investidor, Cota, Cessao, Quote,
  OnRamp, OffRamp, Reserva, RealizacaoCaminho, EventoAudit, WalletProvisioning,
  LiquidacaoSubmit.
- Idempotência em todo write path (privyId, Quote.submitXdrHash,
  LiquidacaoSubmit.xdrHash).
- Audit append-only + 4 hipóteses de clawback (whitepaper §6.5).
- Zod strict + rate-limit + admin CSRF.
- Unit (290) + e2e (chromium contratual + e2e-stub authed/full-flow).

## ⚠️ Gaps aditivos (bloqueiam módulos, não M0)

| Gap | Módulo bloqueado |
|---|---|
| `ClassePLINARF` + `HoldingPLINARF` (PLINARFS/PLINARFB) | M3, M5, M7 |
| `CaminhoCessao` + extensões em `Cessao` | M1, M2 |
| `TipoInvestidor` + extensões em `Investidor` | M3, M4 |
| `NavSnapshot` + cron diário | M5, M7 |
| `JanelaLiquidez` | M5, M7 |
| `PrestadorRegulado` | M6 |
| `lib/integrations/docusign/` | M1, M2, M3 |
| `lib/integrations/administradoras/` | M1, M2 |
| `lib/integrations/fireblocks/` | M0 (P0) |
| `lib/integrations/psp/` | M1 |
| Admin → Clerk | M0 |
| OpenTelemetry traces | M0, M8 |
| Edge Config flags | M0, M9 |
| Vercel Firewall + BotID | M0, M1, M2 |
| `docs/runbooks/` | M0, M8, M9 |
| Soroban contracts (`waterfall.rs`, `nav_oracle.rs`) | M7 |
| i18n EN/PT-BR | M4 |
| Rolling Releases canary | M9 |

## ✅ Decisões tomadas (2026-05-27)

1. **PLINARF legacy = Sênior.** Manter asset code `PLINARF` como Sênior; criar
   `PLINARFB` como Subordinada. Zero churn no código existente.
2. **Regime regulatório: formal.** Esperar FIDC registrado CVM 175 antes de
   abrir `/investir` mainnet pra terceiros. **M3 fica gated por M6.** Schema
   pode entrar agora (campos opcionais); rota controlada via `MAINNET_ENABLED`.

## 🚫 Decisões pendentes

- **OTEL backend** (Datadog vs Grafana Tempo vs open-source). Budget CEO.
- **PSP Pix** (Stark Infra vs BTG vs Inter). Decisão ops/CFO.
- **Anchor intl prioritário** (MoneyGram US vs Settle EU). M4, pós-cutover.

## Scaffolding feito nesta passada (2026-05-27)

- `lib/integrations/{docusign,administradoras,fireblocks,psp}/README.md` — slots
  com interface esperada.
- `docs/runbooks/{clawback,pause-emissao,rotate-fireblocks,incident,mainnet-cutover}.md` — placeholders.
- `lib/env/flags.ts` — helper Edge Config com fallback env.
- `instrumentation.ts` — OTEL no-op em dev, console em staging.

## M0 Foundation — Fase 1 implementada (2026-05-29)

Fechamos tudo do M0 que **não depende de terceiros** (Trilha A — KYB Fireblocks,
conta Clerk — fica pra Fase 2). Refactor aditivo: fluxo testnet inalterado.

### F-M0-1 · Port de assinatura Stellar
- `lib/stellar/signer.ts` (novo): interface `StellarSigner`, `KeypairSigner`
  (lazy — só materializa o `Keypair` no 1º uso), factories `issuerSigner()` /
  `distributorSigner()`.
- **Fail-closed em mainnet**: com `STELLAR_NETWORK=PUBLIC`, issuer/distributor
  exigem Fireblocks e **recusam** assinar com secret em env. `FireblocksSigner`
  concreto fica como TODO (Fase 2), sob o mesmo branch.
- Funder (F-08) segue com secret em env mesmo em mainnet (não está sob Fireblocks).
- Call-sites refatorados: `issuer.ts` (7 ops via `buildSourceTx`/`sign`),
  `audit.ts`, `account.ts` (funder), `transactions.ts`
  (`preSignWithSecret`→`preSignWithSigner`), `services/{liquidacao,tokenizacao}.ts`,
  rotas `buy/swap/build`, `buy/trust-plinarf/submit`, `lab/submit-tx`,
  `scripts/smoke-stellar.ts`, `prisma/seed.ts`.

### F-M0-4 · Alarme de saldo issuer/distributor
- `warnIfBalanceBelowFloor(balances, floor, label)` em `lib/stellar/account.ts`
  (extraído do padrão N-09 do funder; não bloqueia, só loga).
- Constantes `ISSUER_BALANCE_FLOOR` / `DISTRIBUTOR_BALANCE_FLOOR` em `config.ts`.
- Ligado antes de emissão (`issueAsset`), distribuição (`distribute`) e audit-hash.
  Funder refatorado pra reusar o mesmo helper.

### F-M0-3 · OpenTelemetry spans
- Dep `@opentelemetry/api` adicionada (SDK já existia).
- `lib/observability/tracer.ts` (novo): `withSpan` — no-op sem provider (dev).
- Spans `stellar.submit` (issuer/audit/investidor) e `etherfuse.request` (seam
  único de toda chamada SEP-12/24/38 no `request()` do client Etherfuse).

### F-M0-6 · Feature flags (as três conectadas)
- `lib/env/feature-gates.ts` (novo): consumidores das flags de `lib/env/flags.ts`.
- `MAINNET_ENABLED` → `mainnetCutoverGuard()` retorna 503 em rotas mainnet
  sensíveis (`quote`, `buy/swap/build`, `buy/onramp/create`) enquanto off. No-op
  em testnet.
- `INTL_INVESTOR_FLOW` → guard de jurisdição não-BR no `onboard` (inerte até M4).
- `SOROBAN_WATERFALL` → seleção de fonte do NAV (`navSource`) em `pool/summary`
  (inerte até o contrato do M7).
- Documentado em `.env.example` (+ floors + envs Fireblocks/OTEL).

### F-M0-5 · BotID nos forms de lead
- Dep `botid`. `withBotId` em `next.config.ts`, `initBotId` em
  `instrumentation-client.ts` (novo), `checkBotId()` nos handlers
  `vender/lead` e `comprar/lead` (403 se bot, antes do rate-limit). No-op local.
- **Desvio consciente**: padrão suportado é route-handler + next.config + client
  init — **não** `middleware.ts` (o server-check do BotID não roda confiável no
  middleware do Next 16). Rate-limit por IP (`leadLimiter`) mantido.

### F-M0-7 · Runbooks
- Já completos desde 2026-05-27 (clawback, pause-emissão, rotate-fireblocks,
  incident, mainnet-cutover).

### Verificação
- `pnpm typecheck` limpo · `pnpm test` 303/303 (+13 testes novos: signer,
  balance-alarm, feature-gates) · `pnpm lint:auth-guard` ok (21 rotas).
- e2e contratual (chromium) verde; specs `-authed` validadas via `test:e2e:stub`.

### Fase 2 (bloqueada por Trilha A)
- `FireblocksSigner` concreto (F-M0-1) — KYB Fireblocks.
- Admin → Clerk (F-M0-2) — conta Clerk + mapeamento de admins.
- Vercel Firewall/WAF (config dashboard) + teste de carga k6 (aceite F-M0-5/6).
- Assets `PLINARFS`/`PLINARFB` no Stellar Expert mainnet (depende de issuer mainnet).
- Backend OTEL (Datadog vs Grafana — decisão de budget, ainda aberta).
