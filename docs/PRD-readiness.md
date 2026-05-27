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

## Próximo passo

Criar migration `prd_v1_extensions` atômica com as extensões aditivas (todas
opcionais — não afetam o fluxo testnet atual).
