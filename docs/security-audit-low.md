# Security Audit · F-21..F-25 — Bundle de severidade baixa

**Status:** fechado em 2026-05-21 · **PR:** [#17](https://github.com/fabriciofranciscus/plinafinance/pull/17) · **Severidade original:** BAIXA · **Commit:** `5f26cd9`

---

## Resumo

Bundle único pros 5 gaps de severidade baixa apontados no audit. Nenhum exploitável remotamente pra dano financeiro direto — todos eram poluição do sistema (custo on-chain por reenvio, reconnaissance comercial, dados imprecisos no DB, sessão admin sem revogação, fallback silencioso de enum).

Sem dependência entre os fixes → 1 PR.

| ID | Tema | Causa | Correção |
|---|---|---|---|
| F-21 | Lead spam → N txs Horizon | `registerOnChainHash` chamado antes do dedup por email | Lookup de audit recente (24h); reusa `stellarTxHash` |
| F-22 | Quote oracle pre-auth sem barreira | `/api/vender/simular` aberto, sem rate-limit | Token bucket in-memory, 20/min/IP |
| F-23 | Enum `tipo` fallback silencioso | Ternário `=== 'PESSOA_JURIDICA' ? PJ : PF` mascarava typos | Validação estrita; 400 em string inválida |
| F-24 | Cookie admin reutilizável até maxAge | Cookie carregava `sha256(senha)`, sem state server-side | `AdminSession` com sessionId opaco + `revogadoEm` |
| F-25 | Precisão monetária quebrada | `Math.floor(Number(...) * ...)` truncava centavos | `Prisma.Decimal` em todo o pipeline |

---

## Detalhe por fix

### F-21 — Dedup do `registerOnChainHash`

**Arquivo:** `lib/services/realizacao.ts:60-122`

Antes, qualquer reload/reenvio do form em `/comprar` virava nova tx Stellar (Memo.hash) — ~0.00001 XLM cada, mas poluía o Stellar Expert e em mainnet vira custo real.

Solução:
- Lookup `EventoAudit` com `acao = 'LEAD_COMPRADOR_CAPTURADO'` + `leadComprador.email = normalizedEmail` + `criadoEm >= now - 24h` + `stellarTxHash != null`.
- Se encontrado, reusa `{txHash, payloadHash}` em vez de chamar `registerOnChainHash`.
- Janela exportada como `LEAD_DEDUP_WINDOW_MS` (24h) pra tunar.
- O upsert do `LeadComprador` segue rodando — campos editáveis (nome, telefone, intenção) continuam atualizando.

**Por que janela e não dedup absoluto:** lead que volta meses depois pra atualizar intenção/faixa é legítimo re-registrar. 24h cobre dia útil de reload acidental.

### F-22 — Rate-limit em `/api/vender/simular`

**Arquivos:** `lib/rate-limit/in-memory.ts` (novo), `app/api/vender/simular/route.ts`

Rota pré-onboarding (vendedor não tem conta ainda) expunha `calcularFaixaIndicativa()` sem barreira — atacante varre `tipoBem × administradora × valorCarta` mapeando a curva de pricing.

Solução:
- Helper `createRateLimiter({ limit, windowMs })` — token bucket simples, Map LRU naïve (Fluid Compute reusa instância → "good enough" sem KV).
- `clientIp(req)` extrai do `x-forwarded-for` (primeiro IP), fallback `x-real-ip`, fallback `unknown`.
- Aplicado em `/api/vender/simular`: **20 reqs/min/IP**. Resposta 429 com `retry-after: 60`.
- **Bypass dev:** se env `PLINA_RATE_LIMIT_BYPASS` setada e header `X-Plina-Bypass` carrega o mesmo valor, pula o rate-limit. Pra QA/E2E.

Helper é reusável em outras rotas públicas que vierem.

### F-23 — Enum `tipo` estrito em `/comprar/lead`

**Arquivo:** `app/api/comprar/lead/route.ts:44`

Antes:
```ts
const tipo = body.tipo === 'PESSOA_JURIDICA' ? PJ : PF;
```
`'pessoa_juridica'` (minúsculo), `'PJ'`, `'pf'`, qualquer typo virava PF e o operador não via — quebra filtro de funil PJ.

Depois:
```ts
const tipoRaw = String(body.tipo ?? '').trim().toUpperCase();
if (tipoRaw && tipoRaw !== 'PESSOA_FISICA' && tipoRaw !== 'PESSOA_JURIDICA') {
  return NextResponse.json({ error: '...' }, { status: 400 });
}
const tipo = tipoRaw === 'PESSOA_JURIDICA' ? PJ : PF; // default PF se ausente
```

Mantém default PF pra compat com frontend que pode mandar sem o campo, mas rejeita explicitamente string inválida.

### F-24 — `AdminSession` server-side

**Arquivos:**
- `prisma/schema.prisma` — model `AdminSession`
- `prisma/migrations/20260521171255_add_admin_session/migration.sql`
- `lib/auth/admin.ts` — reescrita das 4 funções

Antes, cookie `plina_admin` carregava `sha256("plina:" + ADMIN_PASSWORD)`. `clearAdminCookie()` só zerava no browser — quem capturou o valor (replay de log, screenshot, devtools alheio) continuava válido até `maxAge` (4h).

Depois:
- Cookie carrega `sessionId` opaco (`randomBytes(32).toString('hex')`).
- Tabela `AdminSession { id, sessionId @unique, criadoEm, expiraEm, revogadoEm }`.
- `setAdminCookie()` cria row + seta cookie.
- `isAdminAuthenticated()` lê cookie, busca a row, valida `revogadoEm == null && expiraEm > now()`.
- `clearAdminCookie()` faz `updateMany({ where: { sessionId, revogadoEm: null }, data: { revogadoEm: now() }})` antes de zerar o cookie.

Public API do helper preservada — `app/admin/actions.ts`, `app/layout.tsx`, `app/api/admin/{logout,realizacao,originacao}/route.ts` não foram tocados.

**Tampão até F-04** (Clerk/Auth.js no SPECS_MVP_TECH.md §6). Sem nova abstração nem dep.

### F-25 — `Prisma.Decimal` no `executarCaminhoA`

**Arquivo:** `lib/services/realizacao.ts:302-336`

Antes:
```ts
const valorRealizado = Number(input.valorRealizado);
const custoAquisicao = Math.floor(
  Number(reserva.cota.valorCarta) * (1 - Number(reserva.cota.desagioAquisicao)),
);
const spread = valorRealizado - custoAquisicao;
// persistido: custoAquisicao.toFixed(2) já com centavos perdidos
```
`Math.floor` truncava centavos do custo **antes** de calcular spread; spread carregava o erro. Tudo em IEEE-754 (`Number`).

Depois:
```ts
const valorRealizado = new Prisma.Decimal(input.valorRealizado);
const custoAquisicao = new Prisma.Decimal(reserva.cota.valorCarta)
  .mul(new Prisma.Decimal(1).minus(new Prisma.Decimal(reserva.cota.desagioAquisicao)))
  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
const spread = valorRealizado.minus(custoAquisicao);
```

Persistência via `.toFixed(2)` preserva formato `Decimal(15,2)` do schema. Retorno da função troca `spread: number` por `spread: string` — único caller (`/api/admin/realizacao`) faz `NextResponse.json(result)`, então é transparente.

`Prisma.Decimal` (re-export de `decimal.js`) já estava em uso em outras partes do repo — sem nova dep.

---

## Estado final

| Métrica | Antes | Depois |
|---|---|---|
| Txs Stellar por reload de form `/comprar` | N (1 por POST) | 1 a cada 24h |
| `/api/vender/simular` sem barreira | aberto | 20/min/IP |
| `tipo` inválido em `/comprar/lead` | virava PF silencioso | 400 explícito |
| Cookie admin revogável server-side | não | sim (`AdminSession.revogadoEm`) |
| `executarCaminhoA` preserva centavos | não (`Math.floor`) | sim (`Decimal.HALF_EVEN`) |
| Testes unitários relacionados | 0 | **25** |

## Verificação

```bash
# 1. Testes:
pnpm test
# Tests  85 passed (20 files)  — 60 antigos + 25 novos

# 2. Lint + typecheck:
pnpm lint:auth-guard            # ✓
pnpm typecheck                  # só erros pré-existentes (F-27 + WIP)

# 3. Smoke rate-limit:
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST $URL/api/vender/simular \
    -H 'content-type: application/json' \
    -d '{"tipoBem":"IMOVEL","valorCarta":"100000"}'
done
# Esperado: 200 nas primeiras 20, 429 depois.

# 4. Smoke F-21:
# POST /api/comprar/lead 2x em <24h com mesmo email
# → responses carregam o mesmo txHash

# 5. Smoke F-24:
# Login em /admin, copiar cookie plina_admin, POST /api/admin/logout
# Tentar reusar o cookie em GET /admin → redirect 307 pra login

# 6. F-25 precisão:
# Criar realização com valorCarta=123.45, desagio=0.0567, valorRealizado=130.00
# RealizacaoCaminho.spread persistido deve ser 13.55 (não 13 nem 14)
```

## Migração

`pnpm prisma migrate deploy` antes de subir — cria tabela `AdminSession`. Sessões admin ativas no momento da migração serão invalidadas (operador refaz login). POC interno, aceito.

## Arquivos modificados

```
M app/api/comprar/lead/route.ts                                 (F-23)
M app/api/vender/simular/route.ts                               (F-22)
M lib/auth/admin.ts                                             (F-24)
M lib/services/realizacao.ts                                    (F-21 + F-25)
M prisma/schema.prisma                                          (F-24)
+ lib/rate-limit/in-memory.ts                                   (F-22 helper)
+ prisma/migrations/20260521171255_add_admin_session/migration.sql (F-24)
+ __tests__/api/comprar/lead.test.ts                            (F-23, 5 testes)
+ __tests__/lib/rate-limit.test.ts                              (F-22, 7 testes)
+ __tests__/lib/auth/admin-session.test.ts                      (F-24, 7 testes)
+ __tests__/services/realizacao-lead-dedup.test.ts              (F-21, 4 testes)
+ __tests__/services/realizacao-precisao.test.ts                (F-25, 2 testes)
```

## Próximos fixes do audit original

Cada um vira plano próprio (ordem por prioridade):

| ID | Severidade | Tema |
|---|---|---|
| F-01 | Alto (local) | Rotação dos segredos em `.env`/`.env.local` |
| F-04 | Alto | Admin auth via Clerk/Auth.js — substitui o tampão de F-24 |
| F-06 | Alto | MAC server-side sobre `distributorSigBase64` |
| F-07 | Alto | Reconciliação onramp → swap (job de detecção de fundos presos) |
| F-09 | Médio | Race em `distribute()` mock fora da `$transaction` |
| F-12 | Médio | Validação explícita da sig do investidor pré-Horizon |
| F-16 | Médio | Drop do KYC dummy — bloqueador de mainnet |
| F-20 | Médio | Migrar secrets Stellar pra KMS antes da mainnet |
| F-24 (audit) | Médio | Rate-limit pós-auth por `privyId` (Vercel KV/Upstash) — gêmeo do F-22 |
| F-27 | Baixo | Stub `app/api/investidor/liquidar/build/route.ts` ausente |
