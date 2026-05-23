# Security Audit · C-01..C-07 — Bundle de severidade crítica

**Status:** aberto em 2026-05-22 · **PR:** [#20](https://github.com/fabriciofranciscus/plinafinance/pull/20) · **Severidade original:** CRÍTICA · **Base:** `fix/high-severity-bundle` (stack)

---

## Resumo

Bundle dos 7 gaps **realmente abertos** de severidade crítica do audit interno. Re-inspeção mostrou que parte do diagnóstico do audit estava desatualizada (cookie admin determinístico, `/liquidar/build`) — esses pontos foram redirecionados pra o gap real subjacente. Restaram 7 fixes, cada um em commit próprio dentro do PR único.

Sem dependência circular → bundle único. C-02 e C-06 viraram pré-requisitos: helper de Decimal alimenta C-01/C-03; helper de parse-body é reutilizável pelas próximas waves.

| ID | Tema | Causa | Correção | Commit |
|---|---|---|---|---|
| C-01 | XDR de swap não validada contra Quote | Privy rawSign cobre só `tx.hash()`; backend confiava no payload do envelope | `assertSwapXdrMatchesQuote` parseia o XDR e exige amount/asset/destinations server-side | `19dc950` |
| C-02 | `Number(x).toFixed(7)` perdia stroops | IEEE-754 dropa precisão em R$10M+ | `parseStellarAmount` Decimal end-to-end com regex estrito | `2135a3f` |
| C-03 | `/liquidar/submit` confiava no `body.amount` | Body podia divergir da XDR assinada; DB decrementava X, chain processava Y | `extractLiquidacaoAmount` retorna amount da própria XDR | `693e2d0` |
| C-04 | Sem idempotência no swap e liquidar/submit | Horizon 504 + retry = dupla emissão / duplo débito | `Quote.submitXdrHash @unique` + tabela `LiquidacaoSubmit` (`xdrHash @unique`) | `bbc1de1` |
| C-05 | Admin login sem rate-limit | Brute-force trivial em senha única do POC | `loginRateLimiter` 5 falhas / 15 min por IP, reset on success | `aec2455` |
| C-06 | Sem Zod + sem rate-limit em rotas públicas | Parsing manual aceitava qualquer shape; leads/onboard expostos a spam | `lib/http/parse-body.ts` + `lib/rate-limit/config.ts`; aplicado em P0 | `51282b8` |
| C-07 | `/api/lab/*` sem auth + abuso de friendbot | Pubkey vinha do body; atacante drena funder em mainnet (F-08) | `isLabEnabled()` (testnet+opt-in) + `withAuth`; pubkey vem do JWT | `ad4f44e` |

---

## Detalhe por fix

### C-01 — Validação XDR ↔ Quote em `/buy/swap/submit`

**Arquivos:** `lib/stellar/parse-swap-xdr.ts` (novo), `app/api/investidor/buy/swap/submit/route.ts`

Estado pré-fix: rota lia `quote.toAmount` server-side (já corrigido por commits anteriores), **mas** o XDR enviado pelo cliente nunca era inspecionado. Privy rawSign cobre exclusivamente `tx.hash()` — Stellar processa qualquer XDR cuja assinatura bata com o hash. Não havia ligação cripto entre "amount que o backend espera" e "amount que o investor de fato assinou". Cliente podia forjar XDR com `Operation.payment(PLINARF, 10**9)`, distributor pré-assinava cegamente, Stellar aceitava, audit log registrava `quote.toAmount` (R$99,50) — chain e DB divergiam permanentemente.

Solução:
- `assertSwapXdrMatchesQuote(xdr, expected)` parseia `Transaction.fromXDR(..., networkPassphrase)` e exige:
  - `tx.source === investorPubkey`.
  - Exatamente 2 ops `payment`.
  - Leg 1: source=investor, destination=distributor, asset=TESOURO (resolvido via `resolveTesouroAsset`), amount=expectedAmount.
  - Leg 2: source=distributor, destination=investor, asset=PLINARF (issuer=env), amount=expectedAmount.
- Chamada **antes** de `submitWithPrivySignature`. Mismatch retorna 400 com mensagem específica do op divergente.
- `expectedAmount` é derivado de `quote.toAmount` via `parseStellarAmount(...).toFixed(7)` — mesma string que o `/swap/build` usou.

**Por que não validar sequence number:** o `tx.source.sequenceNumber` muda a cada submit; comparar com `horizon.loadAccount(...)` ao mesmo tempo adicionaria roundtrip + race window com tx pendentes. A defesa em profundidade vale; ficou fora do escopo deste bundle pra não inflar.

### C-02 — Precisão Stellar com `parseStellarAmount`

**Arquivos:** `lib/format/parse-stellar-amount.ts` (novo), `lib/services/liquidacao.ts`, `app/api/investidor/buy/swap/submit/route.ts`

Callsites `Number(x).toFixed(7)` em 3 lugares: build de XDR de liquidação (`liquidacao.ts:114`), submit de liquidação (`liquidacao.ts:162`), persist de `stellarAmount` no swap submit (`swap/submit:126` — esse era Decimal-in mas via `.toFixed(7)` direto, OK). Risco real era IEEE-754 em valores grandes — `Number('10000000.5555555').toFixed(7)` retorna `'10000000.5555555'` no V8 mas o intermediário em float64 já não cabe na mantissa.

Solução:
- `parseStellarAmount(input: string | Decimal): Prisma.Decimal` valida regex `^\d{1,12}(\.\d{1,7})?$` (rejeita scientific notation, vírgula, negativo, zero, >7 casas) e retorna Decimal exato.
- Helper `toStellarAmountString` retorna `.toFixed(7)` em uma chamada.
- Decimal.toFixed é exato — não passa por float.

**13 testes** cobrindo casos: inteiro, 7 casas exatas, <7 casas, Decimal in/out, >7 casas (erro), scientific, negativo, zero, NaN, vírgula, tipo errado, valor grande sem drift.

### C-03 — Amount autoritativo da XDR no `/liquidar/submit`

**Arquivos:** `lib/stellar/parse-liquidacao-xdr.ts` (novo), `lib/services/liquidacao.ts`, `app/api/investidor/liquidar/submit/route.ts`

Estado pré-fix: rota recebia `body.amount` e passava direto pro `submitLiquidacao`, que o usava pra decrementar `saldoEsperado`. XDR era construída server-side em `/liquidar/quote` (autenticado), mas no **submit** o cliente podia enviar XDR (assinada legitimamente para amount X) e mandar `body.amount = Y`. Chain processava X (Stellar não conhece o body), DB decrementava Y, gap |X-Y| ficava "perdido" no saldo — fora de qualquer ledger.

Solução:
- `extractLiquidacaoAmount(xdr, expected)` parseia `Transaction.fromXDR(...)` e exige:
  - `tx.source === investorPubkey`.
  - 1 op payment.
  - `asset = PLINARF` (issuer esperado).
  - `destination = distributorPubkey`.
  - Retorna o `op.amount` (string da XDR).
- `submitLiquidacao` agora **ignora** `input.amount` (mantido como `?: string` deprecated pra retrocompat de chamadas locais) e usa o amount extraído da XDR, normalizado via `parseStellarAmount`.
- Rota relaxa o check `if (!body.amount)` — agora opcional.

### C-04 — Idempotência on-chain em `/swap` e `/liquidar` submits

**Arquivos:** `prisma/schema.prisma`, `prisma/migrations/20260522210000_c04_idempotency_submit/migration.sql`, `app/api/investidor/buy/swap/submit/route.ts`, `lib/services/liquidacao.ts`

F-11 (bundle high) cobriu idempotência das trustlines; faltavam os 2 submits **financeiros**. Sintoma: cliente bate /submit, Horizon retorna 504 (tx pode ou não ter sido aceita), cliente retenta — segunda chamada submete a mesma XDR e Stellar aceita de novo (sequence number da segunda tx é diferente porque o cliente reconstrói; ou rejeita por sequência, deixando a primeira em flight). Audit log e saldo divergiam.

Solução:
- Schema:
  - `Quote.submitXdrHash String? @unique` — nullable + unique → constraint só vale após primeiro reserve; zero backfill.
  - Nova tabela `LiquidacaoSubmit { id, xdrHash @unique, investidorId, txHash?, criadoEm, atualizado }` — liquidação não tem `Quote` persistido.
- Swap submit:
  - `xdrHash = sha256(xdr).digest('hex')` na entrada.
  - Se `quote.consumedAt && quote.submitXdrHash === xdrHash` → 200 idempotente com `consumedTxHash`.
  - Se `quote.consumedAt && submitXdrHash !== xdrHash` → 409 (quote consumido por outra XDR).
  - Reserve antes do submit: `updateMany({where:{id, submitXdrHash:null}, data:{submitXdrHash:xdrHash}})`. Race window: `count === 1` ganha; demais releem `findUnique` — se mesmo xdrHash + consumedTxHash → 200; senão → 409 (em flight).
- Liquidação:
  - `db.liquidacaoSubmit.create({xdrHash, investidorId})` antes do submit.
  - `Prisma.PrismaClientKnownRequestError` com `code === 'P2002'` → reler row; se `txHash` presente, refletir `EventoAudit` correspondente e retornar resultado existente; senão erro "em flight".
  - Após Horizon OK, `update({where:{xdrHash}, data:{txHash}})` dentro da mesma `$transaction` do audit + decrement.

**Migration aplicada em Neon** via `pnpm prisma migrate dev` — zero downtime (coluna nullable + tabela nova).

### C-05 — Rate-limit no admin login

**Arquivos:** `app/admin/actions.ts`, `__tests__/admin/login-rate-limit.test.ts` (novo)

Re-inspeção desfez 2/3 do diagnóstico do audit:
- "Cookie = sha256('plina:'+senha) determinístico" — falso: `lib/auth/admin.ts:34-47` já usava `randomBytes(32).toString('hex')` + `AdminSession` no DB (provavelmente fechado em bundle prévio sem audit-trail).
- "Sem CSRF" — Next 16 Server Actions têm CSRF protection automática via header `Next-Action` + same-origin check no Action ID. Login form usa `useActionState`/`<form action={...}>`; o vetor clássico de cross-origin POST não se aplica.

Gap real era brute-force. Fix:
- `createRateLimiter({limit: 5, windowMs: 15 * 60_000})` singleton no módulo de actions.
- `getClientIp()` extrai de `headers()` (`x-forwarded-for` primeiro, depois `x-real-ip`).
- 6ª tentativa do mesmo IP → `{ok: false, error: "Muitas tentativas..."}`.
- **Sucesso reseta o bucket** (`loginRateLimiter.reset(ip)`) — não penaliza usuário legítimo que acabou de errar uma vez antes de acertar.

In-memory continua OK pra POC (Fluid Compute reusa instância na mesma região); produção real → Upstash/KV.

### C-06 — Zod + rate-limit em rotas P0

**Arquivos:** `lib/http/parse-body.ts` (novo), `lib/rate-limit/config.ts` (novo), `app/api/comprar/lead/route.ts`, `app/api/vender/lead/route.ts`, `app/api/investidor/onboard/route.ts`, `package.json`

Parsing manual (`(await req.json()) as { x?: string }`) aceitava qualquer shape — array onde esperava string, objeto onde esperava número, keys desconhecidas, `__proto__` injection. Sem barreira de IP nas rotas públicas (leads + onboard), spam saturava DB e dependências externas (Etherfuse/Privy).

Solução:
- Dep nova: `zod@4`.
- `parseBody<T>(req, schema): { data: T } | { response: NextResponse }` — wrapper que devolve 400 estruturada (`{error, issues:[{path, message}]}`) em failure.
- `lib/rate-limit/config.ts` expõe 3 limiters singleton:
  - `leadLimiter` 5/min (anti-bot).
  - `publicLimiter` 20/min.
  - `sensitiveAuthLimiter` 10/min (rotas autenticadas caras).
- Schemas `z.object({...}).strict()` em `/comprar/lead`, `/vender/lead`, `/investidor/onboard`. Strict mode rejeita keys extras.

**Escopo realista:** o audit listava 10+ rotas sem Zod/rate-limit. Migrar tudo num bundle único iria furar revisão. Esse PR cobre **P0** (públicas + onboard caro); P1 (vender/aceitar-oferta, comprar/reservar, swap/build, swap/submit, liquidar/quote/submit, etc.) fica como follow-up.

Side-effect benéfico: typecheck dos helpers de XDR (C-01/C-03) também limpou — `Operation.Operation` (que não existe como tipo) virou `Transaction['operations'][number]`.

### C-07 — `/api/lab/*` env-gate + withAuth

**Arquivos:** `lib/env/lab.ts` (novo), `app/api/lab/build-trustline/route.ts`, `app/api/lab/ensure-wallet/route.ts`, `app/api/lab/submit-tx/route.ts`

`/lab/build-trustline` aceitava `{pubkey}` do body sem auth. Em testnet "tudo bem" (friendbot grátis); em mainnet, com F-08 já implementado, o atacante manda pubkey nova → `fundAccountIfNeeded` dispara `createAccount` real **a partir do funder da Plina** — drena XLM operacional. Comentário no código admitia: "Não valida JWT do Privy aqui — é smoke; em produção...".

Solução:
- `isLabEnabled()`: `STELLAR_NETWORK === 'TESTNET' && process.env.LAB_ENABLED === 'true'`. Opt-in duplo. Mainnet **sempre** desligado, mesmo se o admin esquecer.
- Cada rota envelopada em `withAuth` — pubkey sai de `user.publicKey` (JWT), nunca do body.
- Se `!isLabEnabled()` → 404 (não 403; não vaza existência do endpoint).
- Body de `/lab/submit-tx` agora só `{xdr, signatureHex}`.

---

## Excluídos / redirecionados

- **C-05 cookie determinístico**: já corrigido pré-bundle (random + AdminSession DB). Redirecionado pra rate-limit.
- **C-05 CSRF**: mitigado por Next 16 Server Actions nativamente. Não precisa de token explícito.
- **C-07 `/investidor/liquidar/build`**: rota **não existe**. Liquidação é montada via `/liquidar/quote` (já autenticada). Fix aplicou-se só aos `/lab/*`.

---

## Métricas

- **+40 testes** (185 total, era 145 no bundle high):
  - `__tests__/lib/format/parse-stellar-amount.test.ts` (13 testes — C-02)
  - `__tests__/lib/stellar/parse-swap-xdr.test.ts` (8 testes — C-01)
  - `__tests__/lib/stellar/parse-liquidacao-xdr.test.ts` (6 testes — C-03)
  - `__tests__/api/investidor/buy/swap/submit.test.ts` (+3 testes — C-01/C-04)
  - `__tests__/api/investidor/liquidar/submit.test.ts` (+1 teste — C-03)
  - `__tests__/admin/login-rate-limit.test.ts` (2 testes — C-05)
  - `__tests__/lib/http/parse-body.test.ts` (5 testes — C-06)
  - `__tests__/api/lab/build-trustline.test.ts` (2 testes — C-07)
- `pnpm typecheck` clean no escopo modificado (sobram só erros pré-existentes em `.next/types` stale e `scripts/smoke-etherfuse-iframe.ts`).
- `pnpm prisma migrate dev` aplicada com sucesso no Neon (`20260522210000_c04_idempotency_submit`).

---

## Diff resumido

```
M prisma/schema.prisma                                          (C-04)
+ prisma/migrations/20260522210000_c04_idempotency_submit/...   (C-04)
M lib/services/liquidacao.ts                                    (C-02/C-03/C-04)
M app/api/investidor/buy/swap/submit/route.ts                   (C-01/C-02/C-04)
M app/api/investidor/liquidar/submit/route.ts                   (C-03)
M app/admin/actions.ts                                          (C-05)
M app/api/lab/build-trustline/route.ts                          (C-07)
M app/api/lab/ensure-wallet/route.ts                            (C-07)
M app/api/lab/submit-tx/route.ts                                (C-07)
M app/api/comprar/lead/route.ts                                 (C-06)
M app/api/vender/lead/route.ts                                  (C-06)
M app/api/investidor/onboard/route.ts                           (C-06)
+ lib/format/parse-stellar-amount.ts                            (C-02)
+ lib/stellar/parse-swap-xdr.ts                                 (C-01)
+ lib/stellar/parse-liquidacao-xdr.ts                           (C-03)
+ lib/env/lab.ts                                                (C-07)
+ lib/http/parse-body.ts                                        (C-06)
+ lib/rate-limit/config.ts                                      (C-06)
M package.json                                                  (+ zod)
+ __tests__/lib/format/parse-stellar-amount.test.ts             (13 testes)
+ __tests__/lib/stellar/parse-swap-xdr.test.ts                  (8 testes)
+ __tests__/lib/stellar/parse-liquidacao-xdr.test.ts            (6 testes)
+ __tests__/admin/login-rate-limit.test.ts                      (2 testes)
+ __tests__/lib/http/parse-body.test.ts                         (5 testes)
+ __tests__/api/lab/build-trustline.test.ts                     (2 testes)
M __tests__/api/investidor/buy/swap/submit.test.ts              (+3 testes)
M __tests__/api/investidor/liquidar/submit.test.ts              (+1 teste)
M __tests__/api/comprar/lead.test.ts                            (1 teste atualizado)
```

---

## Próximos fixes do audit original

Bundle CRÍTICO fecha o último degrau ≥alto. O que sobra é tudo follow-up:

| ID | Severidade | Tema |
|---|---|---|
| C-06 wave 2 | Crítico (P1) | Zod + rate-limit em vender/aceitar-oferta, comprar/reservar, swap/build, swap/submit, liquidar/quote/submit |
| F-04 | Alto | Admin auth via Clerk/Auth.js — substitui o tampão de F-24 |
| F-06 | Alto | MAC server-side sobre `distributorSigBase64` |
| F-07 | Alto | Reconciliação onramp → swap (job de detecção de fundos presos) |
| F-09 (audit) | Médio | Race em `distribute()` mock fora da `$transaction` |
| F-16 (audit) | Médio | Drop completo do KYC dummy (uploads reais + UI cpf) — bloqueador de mainnet |
| F-20 (audit) | Médio | Migrar secrets Stellar pra KMS antes da mainnet |
| F-27 | Baixo | Stub `app/api/investidor/liquidar/build/route.ts` ausente (rota é via /quote — talvez não exista por design) |
