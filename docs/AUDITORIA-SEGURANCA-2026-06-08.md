# Auditoria de Segurança — Plina

- **Data:** 2026-06-08
- **Branch:** feat/para-investidores
- **Modo:** Diário (gate de confiança 8/10)
- **Escopo:** Auditoria completa (15 fases)

## Stack

| Item | Valor |
|------|-------|
| Framework | Next.js 16.2.4 (App Router) + React 19 |
| Linguagem | TypeScript |
| Package manager | pnpm |
| DB | Postgres (Neon) via Prisma 6 |
| Auth investidor | Privy (Bearer token via `verifyAuthToken`) |
| Auth admin | Sessão server-side + cookie httpOnly + senha única (POC) |
| Blockchain | Stellar SDK 13 (issuer/distributor secrets, Fireblocks em mainnet) |
| Integrações | Etherfuse (ramp fiat), Upstash (rate-limit), Vercel Blob, nodemailer |
| Deploy | Vercel (BotID, Edge Config) |

## Resumo executivo

A postura de segurança do app é **boa**. O time aplicou defesas sólidas e deliberadas:
auth-guard obrigatório (lint no `prebuild`), checks de ownership em todas as rotas que
movem dinheiro, comparação de senha em tempo constante, defesa CSRF dupla (header +
origin), rate-limit em rotas públicas e no login admin, secrets só server-side, flags que
falham **fechado**, e rotas de laboratório gated + 404 em mainnet.

Não há vulnerabilidade crítica confirmada. O achado mais relevante é uma **dependência
com CVE** (Next.js) que pede upgrade.

---

## Achados

### [HIGH] PLINA-01: Next.js 16.2.4 vulnerável (CVE-2026-23870)

- **Confiança:** 9/10 · **Fase:** 3 (Supply chain) / OWASP A03
- **Local:** `package.json:42` (`next: 16.2.4`)

**Descrição:** O `pnpm audit` reporta CVE-2026-23870 (GHSA-8h8q-6873-q5fj) afetando React
Server Components em Next.js 13–16 com App Router. Um request HTTP forjado a um endpoint de
Server Function, ao ser desserializado, pode disparar comportamento indevido. O app usa App
Router + Server Actions (`app/actions/`, `app/admin/actions.ts`), portanto está na superfície
afetada.

**Remediação:** `pnpm up next@latest` para a versão corrigida da linha 16.x e revalidar build/testes.

**Prioridade:** P1 (esta sprint).

---

### [MEDIUM] PLINA-02: Ausência de headers de segurança (CSP, X-Frame-Options, X-Content-Type-Options)

- **Confiança:** 8/10 · **Fase:** 9 / OWASP A02
- **Local:** `next.config.ts` (config vazia, sem `headers()`); sem `middleware.ts`

**Descrição:** Nenhum Content-Security-Policy, X-Frame-Options, X-Content-Type-Options ou
Referrer-Policy é definido. Para um app fintech com PII, isso remove a camada de mitigação
contra clickjacking e contra XSS residual. (A Vercel adiciona HSTS automaticamente, mas não
os demais.)

**Remediação:** adicionar `async headers()` em `next.config.ts` com, no mínimo:
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
e um CSP (começar em report-only e endurecer).

**Prioridade:** P2.

---

### [MEDIUM] PLINA-03: Comprovante PDF acessível por capability URL sem autenticação

- **Confiança:** 7/10 · **Fase:** 9 / OWASP A01
- **Local:** `app/api/comprovante/[cessaoId]/route.ts:15-24`

**Descrição:** O download do comprovante (PDF com dados pessoais/financeiros) não exige
autenticação — o `cessaoId` é o "token de acesso". O `cessaoId` é um `cuid()`, ou seja
**não é enumerável** (não é IDOR sequencial). Porém o padrão de capability URL tem fraquezas
para dado sensível sob CVM 175/LGPD: o id aparece na URL (logs de servidor/Vercel, header
`Referer`, histórico do navegador), não expira e não está vinculado ao investidor autenticado.
Vazou a URL uma vez → acesso permanente ao PDF de outra pessoa.

**Remediação:** vincular o acesso ao investidor autenticado (resolver dono da cessão e checar
`investidorId`) **ou** trocar por token assinado com expiração curta. Adicionar
`Referrer-Policy: no-referrer` na resposta.

**Prioridade:** P2.

---

### [LOW] PLINA-04: postcss < 8.5.10 — XSS no stringify (CVE-2026-41305)

- **Confiança:** 8/10 · **Fase:** 3 / OWASP A03
- **Local:** dependência transitiva `next > postcss@8.4.31`

**Descrição:** XSS via `</style>` não-escapado. Impacto real **baixo** aqui: postcss roda em
build-time e o app não parseia CSS submetido por usuário. Resolve junto com o upgrade do Next.

**Remediação:** o upgrade do PLINA-01 (`next@latest`) deve trazer postcss ≥ 8.5.10. Confirmar com `pnpm audit`.

**Prioridade:** P2.

---

### [INFO] PLINA-05: `pool/summary` sem rate-limit

- **Confiança:** 8/10 · **Fase:** 6 / OWASP A06
- **Local:** `app/api/pool/summary/route.ts`

**Descrição:** GET público agregado, sem auth nem rate-limit. Superfície mínima de DoS se a
query for cara. Sem PII. Considerar `publicLimiter` por consistência.

**Prioridade:** P3.

---

## Controles verificados como SÓLIDOS (sem achado)

- **Secrets:** `.env`/`.env.local` gitignored; só `.env.example` (placeholders vazios) versionado. Sem secret em git history. Sem `NEXT_PUBLIC_*` com secret. Sem logging de secrets/tokens/XDR.
- **AuthZ rotas investidor:** `withAuth`/`requireInvestidor` (token Privy) + lint `require-auth-guard` no `prebuild` bloqueia regressão. Checks de ownership (`order.investidorId !== user.investidorId`) presentes em onramp/offramp/status, sandbox-pay, etc.
- **AuthZ admin:** sessão server-side em `AdminSession` (revogável), cookie httpOnly+sameSite+secure, senha em tempo constante (`passwordMatches`), CSRF (header `x-plina-admin` + validação de origin), rate-limit no login (5 falhas/15min/IP).
- **Injeção:** zero SQL cru (Prisma parametrizado), zero `child_process`/`exec`, zero `dangerouslySetInnerHTML`/`eval`/`new Function`.
- **Input validation:** zod nas rotas públicas e de quote (`comprar/lead`, `vender/lead`, `vender/simular`, `investidor/quote`).
- **Rate-limit:** Upstash em prod com fallback in-memory; aplicado em lead, simular, kyc, onboard, liquidar/quote, login admin.
- **Feature flags:** falham **fechado** (default `false`); `MAINNET_ENABLED` como kill-switch.
- **Rotas lab:** gated por `LAB_ENABLED` + `withAuth`; retornam 404 em mainnet (não vazam existência).
- **CORS `*`:** só em `.well-known/stellar.toml` (exigência SEP-1, arquivo público) — correto.
- **IDs:** `cuid()` em todos os models — não enumeráveis.

---

## Calibração de confiança

- Total de achados: 5
- CRITICAL: 0
- HIGH: 1 (conf. 9/10)
- MEDIUM: 2 (conf. média 7.5/10)
- LOW: 1 (conf. 8/10)
- INFO: 1 (conf. 8/10)
- Falsos positivos filtrados: CORS em stellar.toml, postcss-como-runtime, comprovante-como-IDOR-sequencial
- Modo: Diário (gate 8/10)

## Roadmap de remediação

| Prioridade | Achados | Esforço estimado |
|-----------|---------|------------------|
| P1 | PLINA-01 (upgrade Next.js) | ~1-2h (upgrade + regressão) |
| P2 | PLINA-02 (headers), PLINA-03 (auth comprovante), PLINA-04 (postcss, junto do P1) | ~3-4h |
| P3 | PLINA-05 (rate-limit pool) | ~15min |
