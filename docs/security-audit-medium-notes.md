# Security Audit · N-08..N-13 — Bundle de severidade média (notes)

**Status:** aberto em 2026-05-23 · **PR:** [#22](https://github.com/fabriciofranciscus/plinafinance/pull/22) · **Severidade original:** MÉDIA · **Base:** `fix/n14-n17-low-bundle` (stack)

---

## Resumo

Bundle dos 6 gaps **médios** (prefixo `N-` no audit interno de 2026-05-22) sobreviventes a todos os bundles ≥crítico anteriores. Mistura de DoS barato, CSRF surface, precisão de Decimal, e um buraco de auditoria CVM 175 (`cancelarReserva` sem prova on-chain). Nenhum bloqueia operação atual, mas a soma deles desconforta antes de mainnet.

Não confundir com bundle F-14..F-20 ("medium" antigo) — sufixo `-notes` segue convenção iniciada em `security-audit-notes.md` (N-14..N-17).

| ID | Tema | Causa | Correção | Commit |
|---|---|---|---|---|
| N-08 | `/liquidar/quote` sem rate-limit (DoS DB barato) | Endpoint autenticado faz 2 findMany por request | `sensitiveAuthLimiter` (10/min/IP, bucket compartilhado com onboard) | `992b485` |
| N-09 | Funder mainnet sem cap nem alarme de saldo | Múltiplos KYCs aprovados drenam 2 XLM por wallet | Cap diário via `EventoAudit(WALLET_FUNDED)` + warn de saldo | `cc4c948` |
| N-10 | Admin POST sem CSRF token (apenas SameSite=lax) | Lax permite top-level form submit cross-site | Header `x-plina-admin: 1` validado server-side | `e24620a` |
| N-11 | `/admin/logout` aceita POST cross-site via lax | DoS de produtividade via `<form>` cross-site | Mesmo header CSRF + `<form>` virou button + fetch | `e24620a` |
| N-12 | Etherfuse toAmount com >7 decimais trunca silencioso | Prisma `Decimal(20,7)` arredonda no save sem alarme | Round explícito HALF_EVEN antes do persist + log | `9159da8` |
| N-13 | `cancelarReserva` não grava EventoAudit nem hash on-chain | Gap de auditoria CVM 175 | Refactor seguindo padrão de `criarReserva` | `2f9610b` |

---

## Detalhe por fix

### N-08 — Rate-limit em `/api/investidor/liquidar/quote`

**Arquivos:** `app/api/investidor/liquidar/quote/route.ts`, `__tests__/api/investidor/liquidar/quote.test.ts`

Handler autenticado mas executa 2 `findMany` (Cota + RealizacaoCaminho) por request via `calcularValorLiquidacao`. Vetor barato de DoS de connection pool com 1 sessão Privy válida: 60 chamadas/min × 2 queries = 120 queries/min por sessão, suficiente pra degradar pool em pico de demanda real.

Solução:
- Importar `sensitiveAuthLimiter` + `clientIp` de `lib/rate-limit/config.ts` (criado em C-06; 10 req/min/IP).
- Wrap antes do parse de body → 429 antes do DB ser tocado.
- Mesmo bucket de `/onboard` por design — rotas autenticadas caras compartilham.

**1 teste novo** cobrindo o 429 após 10 chamadas seguidas do mesmo IP.

### N-09 — Cap diário do funder + alarme de saldo

**Arquivos:** `lib/stellar/config.ts`, `lib/stellar/account.ts`, `prisma/schema.prisma`, `prisma/migrations/20260523164709_n09_n13_audit_enum_values/migration.sql`, `__tests__/lib/stellar/funder-cap.test.ts`

`fundViaCreateAccount` em mainnet (F-08 path) não tinha cap nem alarme. Vetor real: múltiplos investidores KYC-aprovados em sequência. Cada wallet nova drena `STELLAR_FUNDER_STARTING_BALANCE` (default 2 XLM); 100 KYCs = 200 XLM sem alerta.

Solução em camadas:
1. **Cap diário global** (`FUNDER_DAILY_CAP`, default 100):
   - Antes de cada fund, `db.eventoAudit.count({ where: { acao: 'WALLET_FUNDED', criadoEm: { gte: 24h atrás } } })`.
   - Se ≥ cap → `throw 'funder daily cap atingido (...) — operador deve investigar antes de bumpar'`. Sem auto-reset; falha pra alto.
2. **Alarme de saldo** (`FUNDER_BALANCE_FLOOR`, default '50' XLM):
   - Lê `funderAccount.balances` (native), parseia número.
   - Abaixo do floor → `logStellarError('[funder] saldo baixo', ...)`. **Não bloqueia** — resiliência > pureza; operador vê no log e bumpa antes da próxima drenagem.
3. **Audit log** após cada submit:
   - Cria `EventoAudit({ acao: 'WALLET_FUNDED', stellarTxHash, payload: { destination, startingBalance } })`. Auditável via mesmas rotas/exportações.

Por que `EventoAudit` em vez de tabela própria: já existe + `WALLET_FUNDED` se encaixa na semântica "toda mudança relevante registra" do whitepaper §6.1; o cap fica auto-instrumentado.

Migration `ALTER TYPE "AcaoAudit" ADD VALUE 'WALLET_FUNDED'` agrupada com N-13.

**3 testes** cobrindo cap atingido (throw, audit não cria), balance baixo (warn no log + submit ok), happy path.

### N-10 + N-11 — CSRF defense em rotas admin

**Arquivos:** `lib/auth/admin-csrf.ts` (novo), `app/api/admin/{realizacao,originacao,logout}/route.ts`, `app/admin/{comprador,vendedor}-pipeline.tsx`, `components/AppHeader.tsx`, `__tests__/lib/auth/admin-csrf.test.ts`

Cookie `plina_admin` é SameSite=lax. Lax bloqueia POST cross-site XHR (preflight CORS) mas permite top-level form submit. Vetores:
- **N-10**: `<form enctype="text/plain" action="https://plina.app/api/admin/realizacao">` hospedado em outro origin com payload JSON-shaped (uppercase + dummy boundary) podia tentar disparar ação admin. Improvável de executar com sucesso (Content-Type pega), mas a defesa atrás é só Content-Type — não há fence explícita.
- **N-11**: `<form action="/api/admin/logout" method=POST>` cross-site força logout = DoS de produtividade.

Solução unificada `requireAdminCsrf(req)`:
1. Exige header `x-plina-admin: 1`. Forms HTML **não conseguem** setar headers customizados — só fetch/XHR, que dispara preflight CORS em cross-origin, que falha sem CORS allow.
2. Defesa em profundidade: valida `origin` (preferido) ou `referer` (fallback) contra o host do próprio request. Mismatch → 403.
3. Retorna `NextResponse` 403 pronta pro caller ou `null` quando passa.

Aplicado nas 3 rotas POST admin **antes** do `isAdminAuthenticated`.

UI ajustada:
- `app/admin/comprador-pipeline.tsx` e `vendedor-pipeline.tsx`: `fetch(...)` agora seta `'x-plina-admin': '1'`.
- `components/AppHeader.tsx`: `<form action="/api/admin/logout">` virou `<button onClick={fetch(...)}>` + redirect manual via `window.location.href`.

Não convertemos pra Server Action (Next 16 nativa) porque o header check é mais barato e cobre o vetor sem refatorar UX.

**7 testes** cobrindo header missing/wrong, origin same-host/cross-host/null/invalid, referer fallback.

### N-12 — Round explícito + log de truncamento em `Quote.create`

**Arquivos:** `app/api/investidor/quote/route.ts`, `__tests__/api/investidor/quote.test.ts`

Etherfuse devolve `toAmount`/`fromAmount` em string com precisão até 18 dígitos (resposta da API REST). `new Prisma.Decimal(quote.toAmount)` aceita arbitrário; Prisma trunca silencioso no save em `Decimal(20,7)`. Diferença sub-stroop vira dust no swap atômico downstream.

Solução:
- Antes de persistir, `toAmountRaw.toDecimalPlaces(7, Prisma.Decimal.ROUND_HALF_EVEN)` (banker's rounding).
- Se `!raw.eq(rounded)` → `logStellarError('[quote] toAmount truncado pra 7 casas', new Error('raw=... rounded=...'))`. Operador vê o caso real e ajusta com Etherfuse se for sistemático.
- Mesmo tratamento defensivo em `fromAmount` (Etherfuse devolve BRL com 2 casas hoje; custa nada manter consistente).

**2 testes novos**: input com 9 decimais arredonda pra `1.1234568`; input com ≤7 decimais intacto.

### N-13 — `cancelarReserva` registra EventoAudit + hash on-chain

**Arquivos:** `prisma/schema.prisma`, `prisma/migrations/20260523164709_n09_n13_audit_enum_values/migration.sql`, `lib/services/realizacao.ts`, `app/api/admin/realizacao/route.ts`, `__tests__/services/realizacao-cancelar.test.ts`

`cancelarReserva` era o único state-change em todo o pipeline de realização sem prova on-chain — viola whitepaper §6.1 ("toda mudança de estado relevante registra") e gap de auditoria CVM 175. Não era vuln de segurança, era gap de transparência.

Solução seguindo padrão de `criarReserva` (no mesmo arquivo, ~50 linhas acima):
- Novo enum value `RESERVA_CANCELADA` em `AcaoAudit` (migration agrupada com N-09).
- `buildAuditPayload('reserva_cancelada', reservaId, { reservaId, cotaId, leadCompradorId, statusAnterior, cotaStatusAnterior })`.
- `registerOnChainHash(payload)` → Memo.hash on-chain (mesma mecânica do whitepaper).
- `EventoAudit({ acao: 'RESERVA_CANCELADA', operador, cotaId, leadCompradorId, payloadJson, payloadHash, stellarTxHash })` dentro da `$transaction` junto com `reserva.update` + `cota.update`.
- Retorna `{ payloadHash, txHash }` pro caller (consistente com `criarReserva`).
- `/api/admin/realizacao` agora propaga os hashes pro frontend (link Stellar Expert).

**4 testes** cobrindo reserva inexistente (throw, sem hash), não-ATIVA (throw, sem hash), happy path (audit + hash + cota DISPONIVEL), cota não-RESERVADA (cancela só a reserva).

---

## Métricas

- **+17 testes** (210 total, era 193 no bundle notes):
  - `__tests__/api/investidor/liquidar/quote.test.ts` (+1 teste — N-08)
  - `__tests__/api/investidor/quote.test.ts` (+2 testes — N-12)
  - `__tests__/lib/auth/admin-csrf.test.ts` (7 testes — N-10/N-11)
  - `__tests__/services/realizacao-cancelar.test.ts` (4 testes — N-13)
  - `__tests__/lib/stellar/funder-cap.test.ts` (3 testes — N-09)
- `pnpm typecheck` clean no escopo modificado.
- `pnpm prisma migrate dev` aplicada com sucesso no Neon (`20260523164709_n09_n13_audit_enum_values`).

---

## Diff resumido

```
M prisma/schema.prisma                                          (N-09/N-13)
+ prisma/migrations/20260523164709_n09_n13_audit_enum_values/.. (N-09/N-13)
M lib/stellar/config.ts                                         (N-09)
M lib/stellar/account.ts                                        (N-09)
M lib/services/realizacao.ts                                    (N-13)
M app/api/investidor/liquidar/quote/route.ts                    (N-08)
M app/api/investidor/quote/route.ts                             (N-12)
M app/api/admin/realizacao/route.ts                             (N-10 + N-13 caller)
M app/api/admin/originacao/route.ts                             (N-10)
M app/api/admin/logout/route.ts                                 (N-11)
M app/admin/comprador-pipeline.tsx                              (N-10 header)
M app/admin/vendedor-pipeline.tsx                               (N-10 header)
M components/AppHeader.tsx                                      (N-11 button+fetch)
+ lib/auth/admin-csrf.ts                                        (N-10/N-11)
+ __tests__/lib/auth/admin-csrf.test.ts                         (7 testes)
+ __tests__/services/realizacao-cancelar.test.ts                (4 testes)
+ __tests__/lib/stellar/funder-cap.test.ts                      (3 testes)
M __tests__/api/investidor/liquidar/quote.test.ts               (+1 teste)
M __tests__/api/investidor/quote.test.ts                        (+2 testes)
```

---

## Follow-ups (fora do escopo deste bundle)

| ID | Tema | Por que ficou fora |
|---|---|---|
| F-04 | Admin auth via Clerk/Auth.js | Tech-debt admitido em `lib/auth/admin.ts:9` — bundle de produto. Header CSRF é a defesa interina. |
| N-13 wave 2 | Auditoria de outros state-changes faltando hash | Audit não listou outros; varredura ampla vira PR próprio. |
| N-09 wave 2 | Métricas estruturadas (Prometheus) em vez de `console.error` | Logger estruturado fica como issue separada — toda a stack ainda usa `console.error`. |
| C-06 wave 2 | Zod + rate-limit nas P1 | Pendente do bundle critical. |
| F-06 | MAC server-side sobre `distributorSigBase64` | Independente. |
| F-07 | Reconciliação onramp → swap | Job próprio. |
