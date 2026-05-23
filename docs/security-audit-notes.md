# Security Audit · N-14..N-17 — Bundle de severidade baixa (notes)

**Status:** aberto em 2026-05-22 · **PR:** [#21](https://github.com/fabriciofranciscus/plinafinance/pull/21) · **Severidade original:** BAIXA · **Base:** `fix/critical-severity-bundle` (stack)

---

## Resumo

Bundle dos 4 gaps **notes** (prefixo `N-` no audit interno) sobreviventes a todos os bundles ≥baixa anteriores. Nenhum bloqueia mainnet — todos são limpeza de borda: observability, semantics de payload, defesa em profundidade. Cada fix em commit próprio.

Sem dependência entre fixes → bundle único faz sentido. Não confundir com `security-audit-low.md` (F-21..F-25); este bundle usa prefixo `N-` por isso o arquivo separado.

| ID | Tema | Causa | Correção | Commit |
|---|---|---|---|---|
| N-14 | CPF dummy persistido em sandbox vaza pra mainnet | Re-onboard curto-circuita; flag de sintético nunca existiu | Schema +2 colunas + guard em `assertElegivelParaTrustline` | `ae8c3d3` |
| N-15 | NAV calculado antes do submit (janela stale em concorrência) | Snapshot pré-submit em variável local; impacto pequeno no MVP | Sinalização (comment + `performance.now()` warn > 2s) | `a17c2d2` |
| N-16 | `catch {}` mudos em agreements/getKycStatus | Falhas Etherfuse ficavam invisíveis pro operador | `logStellarError` mantendo o swallow funcional | `5239e98` |
| N-17 | `payloadJson` cru no events route vaza `_type/_at/_ref` | Marcadores canônicos pra hash determinístico nunca foram strippeados | `stripInternalKeys` top-level | `b9f9590` |

---

## Detalhe por fix

### N-14 — `cpfNormalizado` + `isSyntheticCpf` em `Investidor`

**Arquivos:** `prisma/schema.prisma`, `prisma/migrations/20260522220811_n14_synthetic_cpf_flag/migration.sql`, `lib/services/investidor.ts`

Estado pré-fix: `lib/services/investidor.ts:74` usava `cpfNormalizado = parseCpf(input.cpf) ?? '52998224725'` em sandbox. O CPF dummy ia pro Etherfuse mas não era persistido no nosso DB. Cenário que abriu o gap:
1. Investidor onboarda em sandbox sem CPF → customer Etherfuse criado com dummy.
2. Equipe flipa `STELLAR_NETWORK=PUBLIC` no deploy.
3. Re-onboard do mesmo email entra no branch `lines 81-101` (já AUTORIZADO) e retorna sem re-validar CPF.
4. Operações subsequentes (onramp, swap) usam o `etherfuseCustomerId` cujo customer mainnet tem CPF inválido. Etherfuse rejeita lá na frente, mas a Plina não tem visibilidade aqui.

Solução:
- Schema +2 colunas em `Investidor` (migration zero-backfill — nullable + bool default):
  - `cpfNormalizado String?` — 11 dígitos sem máscara, útil pra auditoria + matching com Etherfuse.
  - `isSyntheticCpf Boolean @default(false)` — `true` quando o CPF veio do fallback dummy.
- `onboardInvestidor` calcula `isSyntheticCpf = !parsedCpf` em sandbox; em mainnet sempre `false` (F-12 já garante CPF válido obrigatório).
- Upsert grava ambas as colunas em `create` e `update` — refresh em re-onboard.
- `assertElegivelParaTrustline` ganha guard novo: `STELLAR_NETWORK === 'PUBLIC' && investidor.isSyntheticCpf` → throw `"Investidor com CPF sintético — exige re-KYC antes de operar em mainnet (N-14)"`. Bloqueia trustline + swap pelo mesmo ponto que já bloqueia KYC pendente.

**Limite consciente:** rows criadas **antes** desta migration em sandbox ficam com `isSyntheticCpf=false` (default da coluna). É aceitável porque o fluxo real de "sandbox → mainnet" da Plina é novo deploy + DB novo, não env flip in-place; quem flipar in-place sabe que tem que rodar audit de rows preexistentes.

**Fora do escopo:** UI de re-KYC quando flag é true. Bundle só *bloqueia*; o caminho de remediação fica como follow-up (provavelmente `/onboard?reKyc=true` + `EventoAudit('RE_KYC_REQUERIDO')`).

### N-15 — Sinalização de janela NAV→submit longa

**Arquivos:** `lib/services/liquidacao.ts`

Estado real: `submitLiquidacao` calcula NAV/token **antes** de `submitTransaction`. Se duas liquidações concorrentes rodam no mesmo segundo, o segundo payload on-chain reflete supply pré-primeira tx. Em MVP testnet o impacto é cosmético (NAV é estimativa, BRL é fictício); em mainnet vira problema real. Audit aceitou "OK pra MVP, sinalizar".

Solução (deliberadamente leve):
- Comment localiza o trade-off + aponta o follow-up: "replicar NAV/token snapshot por epoch on-chain antes da venda real em mainnet".
- `performance.now()` mede a janela cálculo→submit. Se > 2s, `logStellarError('[liquidacao] janela NAV→submit longa', ...)` — só warn, não erro.
- NÃO mover o cálculo pra dentro de uma `$transaction` Postgres; Stellar submit não é transacional com DB, e a abordagem certa é epoch snapshot, não lock.

Sem mudança de semântica.

### N-16 — `catch {}` → `logStellarError`

**Arquivos:** `lib/services/investidor.ts`

Dois `catch {}` swallow em `onboardInvestidor`:
- L159-164: `acceptElectronicSignature` + `acceptTermsAndConditions`. Falha esperada em sandbox sem phone (documentado em PLINA-MOD-005). Onboard segue.
- L168-175: `getKycStatus`. Rede flap retornaria `pending` por default.

Comportamento certo nos dois casos é "swallow"; problema era que operador não distinguia "Etherfuse marcou pending" (esperado) de "nossa chamada quebrou" (alarme). Fix mantém o swallow funcional (try/catch continua) e expõe o erro no stderr estruturado via `logStellarError`.

Helper `lib/stellar/log-error.ts` é nominalmente Stellar mas é genérico (`prefix + console.error`). Prefixos novos: `[onboard:agreements]` e `[onboard:kyc-status]`.

Sem teste novo — verificação é manual em smoke runtime.

### N-17 — `stripInternalKeys` no events route

**Arquivos:** `lib/audit/strip-internal.ts` (novo), `app/api/investidor/events/route.ts`, `__tests__/lib/audit/strip-internal.test.ts` (6 testes)

Estado pré-fix: `app/api/investidor/events/route.ts:42` devolvia `payload: e.payloadJson` cru. `payloadJson` carrega `_type`, `_at`, `_ref` injetados por `buildAuditPayload` em `lib/stellar/audit.ts:74-86` — marcadores internos pra hash determinístico. Não vaza PII (payload é hash-only), mas vaza o shape canônico. User classificou como estético.

Solução:
- `stripInternalKeys(payload): JsonValue | null` remove top-level keys que começam com `_`. **Top-level only por design** — o leak é o envelope canônico, não dados aninhados. Valores objeto/array passam intactos.
- Events route mapeia via helper. Helper fica reutilizável pra qualquer rota futura que sirva `payloadJson`.

---

## Métricas

- **+8 testes** (193 total, era 185 no bundle critical):
  - `__tests__/lib/audit/strip-internal.test.ts` (6 testes — N-17)
  - `__tests__/services/investidor-synthetic-cpf.test.ts` (2 testes — N-14)
- `pnpm typecheck` clean no escopo modificado (sobram só erros pré-existentes em `.next/types` stale e `scripts/smoke-etherfuse-iframe.ts`).
- `pnpm prisma migrate dev` aplicada com sucesso no Neon (`20260522220811_n14_synthetic_cpf_flag`).

---

## Diff resumido

```
M prisma/schema.prisma                                          (N-14)
+ prisma/migrations/20260522220811_n14_synthetic_cpf_flag/...   (N-14)
M lib/services/investidor.ts                                    (N-14/N-16)
M lib/services/liquidacao.ts                                    (N-15)
M app/api/investidor/events/route.ts                            (N-17)
+ lib/audit/strip-internal.ts                                   (N-17)
+ __tests__/lib/audit/strip-internal.test.ts                    (6 testes)
+ __tests__/services/investidor-synthetic-cpf.test.ts           (2 testes)
```

---

## Follow-ups (fora do escopo deste bundle)

| ID | Tema | Por que ficou fora |
|---|---|---|
| N-14 wave 2 | UI de re-KYC quando `isSyntheticCpf=true` em mainnet | Mudança de produto, não de segurança. Bundle só fecha o vetor de leak. |
| N-15 wave 2 | NAV/token snapshot por epoch on-chain | Refactor estrutural — requer modelo de epoch + memo.hash em snapshot ao invés de payload. |
| C-06 wave 2 | Zod + rate-limit nas P1 (vender/aceitar-oferta, comprar/reservar, swap/build, swap/submit, liquidar/quote/submit) | Bundle critical cobriu só P0; P1 fica como PR próprio. |
| F-04 | Admin auth via Clerk/Auth.js | Bundle de produto, não de fix. |
| F-06 | MAC server-side sobre `distributorSigBase64` | Independente. |
| F-07 | Reconciliação onramp → swap | Job separado. |
