# Security Audit · F-08, F-10, F-11, F-12 — Bundle de severidade alta

**Status:** aberto em 2026-05-22 · **PR:** [#19](https://github.com/fabriciofranciscus/plinafinance/pull/19) · **Severidade original:** ALTA · **Base:** `fix/medium-severity-bundle` (stack)

---

## Resumo

Bundle dos gaps **realmente abertos** de severidade alta do audit. Inspeção prévia mostrou que 2 dos 6 (F-09, F-13) já estavam fechados por bundles anteriores — excluídos do escopo e documentados nos riscos. Restaram 4 fixes, cada um em commit próprio dentro do PR único.

Sem dependência circular entre os fixes → bundle único faz sentido.

| ID | Tema | Causa | Correção | Commit |
|---|---|---|---|---|
| F-08 | `fundAccountIfNeeded` em mainnet | Friendbot hardcoded; quebra silenciosa em `STELLAR_NETWORK=PUBLIC` | Branch testnet/mainnet com `createAccount` op via funder | `a0bf858` |
| F-10 | Precisão Decimal em NAV/revenda | `Math.floor(Number(Decimal))` em valores R$10M+ trunca centavos | Aritmética interna em `Prisma.Decimal`; APIs `*AsDecimal` paralelas | `ace0d24` |
| F-11 | Sem idempotência on-chain em buy/submit | Trustline submetida; se authorize falha, retry duplica step 1 | Persist step-by-step + checkpoint reads no início | `9e26860` |
| F-12 | CPF dummy `'52998224725'` em mainnet | Hardcode sandbox vazaria pra produção sem branch | Branch `STELLAR_NETWORK`; mainnet exige CPF módulo-11 válido | `c46755f` |

---

## Detalhe por fix

### F-08 — `fundAccountIfNeeded` quebra em mainnet

**Arquivos:** `lib/stellar/account.ts`, `lib/stellar/config.ts`

Antes, `fundAccountIfNeeded` chamava `friendbot.stellar.org` sem checar `STELLAR_NETWORK`. Friendbot só existe em testnet — em mainnet retorna erro HTTP que quebra onboarding silenciosamente (a função throw mas sem contexto de "rede errada"). Mesma armadilha em `createFundedAccount` (helper de teste).

Solução:
- `fundAccountIfNeeded`: branch por `STELLAR_NETWORK`.
  - `TESTNET` → friendbot (comportamento atual).
  - `PUBLIC` → `createAccount` op a partir de uma conta funder configurada via `STELLAR_FUNDER_SECRET` + `STELLAR_FUNDER_PUBLIC`. Starting balance: `STELLAR_FUNDER_STARTING_BALANCE` (default `'2'` XLM — cobre base reserve + 1 trustline).
- Sem funder configurado em mainnet → erro explícito `"STELLAR_FUNDER_SECRET/PUBLIC ausentes"` em vez de silenciar.
- Validação extra: `Keypair.fromSecret(...).publicKey()` precisa bater com `STELLAR_FUNDER_PUBLIC` — protege contra typo onde o secret é trocado mas o public fica desatualizado.
- `createFundedAccount` (testnet-only): throw em mainnet ("`createFundedAccount é testnet-only — em mainnet use fundAccountIfNeeded`").

**Por que não cachear `loadAccount(funder)`:** sequence number do funder muda a cada `submitTransaction`. Cachear levaria a `tx_bad_seq` no segundo onboard. O `loadAccount` é HTTP roundtrip mas único por onboarding — não vale otimizar prematuramente. (Plano original mencionou cache 5s; descartado durante implementação.)

### F-10 — Precisão Decimal em NAV e revenda

**Arquivos:** `lib/services/pool.ts`, `lib/services/realizacao.ts`, `lib/services/originacao.ts`, `lib/services/liquidacao.ts`

Estado pré-fix:
- `pool.ts` operava com `number` puro internamente — `valorCarta * (1 - desagio)` em IEEE-754 perde centavos quando valor > 10⁶ e desagio é fracionário (ex: `10000000.55 * 0.999 = 9990000.549449...` em float).
- `realizacao.ts:202`: `Math.floor(Number(cota.valorCarta) * (1 - Number(cota.desagioRevenda)))` — duplo descarte (Math.floor trunca para inteiro, persistido em payload de auditoria).
- `originacao.ts:168`: idêntico — `Math.floor` antes de `.toFixed(2)` no persist; centavos sumiam.
- `liquidacao.ts:87`: `brlEquivalente: amount * unit` (números), persistido em payload `'plinarf_liquidado'`.

**Spread já estava correto** desde F-25 (bundle low) — `realizacao.ts:334-341` usa Decimal end-to-end. O gap eram os cálculos de *estimativa* e os helpers de `pool.ts`.

Solução:
- `pool.ts`:
  - `toNumber()` interno virou `toDecimal()`. Toda aritmética em `Prisma.Decimal` com `ROUND_HALF_EVEN` em 2 casas (BRL) ou 8 casas (NAV/token).
  - Funções públicas (`navDaCota`, `caixaRealizado`, etc.) continuam retornando `number` via `.toNumber()` — preserva compatibilidade com UI/JSON sem ripple massivo.
  - Variantes `*AsDecimal` exportadas (`navDaCotaAsDecimal`, `navPorTokenAsDecimal`, etc.) pra callers que persistem ou compõem precisão crítica.
- `realizacao.ts:202`: `valorRevenda` calculado em Decimal e serializado via `.toFixed(2)` (string) no payload de auditoria.
- `originacao.ts:168`: `valorLiquido` em Decimal — já era usado downstream como Decimal (linhas 185/206 fazem `.toFixed(2)`), só o cálculo inicial estava errado.
- `liquidacao.ts:87`: `brlEquivalente` computado via `navPorTokenAsDecimal(...).mul(Decimal(amount)).toDecimalPlaces(2, ROUND_HALF_EVEN).toNumber()` antes de serializar.

**Por que `ROUND_HALF_EVEN`:** banker's rounding. Padrão CVM/IFRS pra evitar viés acumulado quando muitos arredondamentos compostos rodam.

**Por que não migrar toda a API pública pra Decimal:** ripple gigante (UI, JSON responses, `Math.floor` em `app/comprar/page.tsx`, etc.). O ganho real está em (1) eliminar a perda *durante composição* e (2) garantir precisão na borda de persistência. Com aritmética interna em Decimal e `.toNumber()` só no fim, IEEE-754 só vê o valor *já arredondado* — sem espaço pra drift.

### F-11 — Idempotência on-chain no `/buy/trust-plinarf/submit`

**Arquivos:** `app/api/investidor/buy/trust-plinarf/submit/route.ts`, `app/api/investidor/buy/trust-tesouro/submit/route.ts`

Sintoma original (PLINARF): handler executa 3 passos em sequência:
1. `submitWithPrivySignature(xdr)` — trustline tx, investor assina via Privy.
2. `authorizeTrustline(issuerSecret, ...)` — issuer autoriza, server assina.
3. `db.$transaction` persiste hash de ambos + cria `EventoAudit`.

Se passo 2 falha (network, throttle, issuer offline), passo 1 já está on-chain mas **nada está persistido**. Cliente bate retry → passo 1 reexecuta (trustline duplicada se a primeira virou nada-feito ou re-submetida; ambiguidade). Stellar txs são imutáveis — não há rollback.

Solução:
- **Checkpoint reads no início** (antes de qualquer tx on-chain):
  - `investidor.trustlineTxHash` indica step 1 feito.
  - `EventoAudit` com `acao='TRUSTLINE_AUTORIZADA'` indica step 2 feito.
- **Branch por estado:**
  - Ambos persistidos → 200 idempotente com hashes existentes (`idempotent: true` no payload).
  - Só trustline persistida → skip step 1, executa só `authorizeTrustline`. Log via `logStellarError` sinaliza "retomando após falha".
  - Nada → fluxo normal, mas **persiste `trustlineTxHash` ANTES de chamar `authorizeTrustline`** — o gap original era persist-no-fim.
- Audit log (`EventoAudit`) escrito após `authorizeTrustline` com sucesso, fora da transação multi-passo (que agora não existe mais — step 1 commit é separado).

Tesouro (`/buy/trust-tesouro/submit`):
- Step único (TESOURO não tem AUTH_REQUIRED). Idempotência simples: se `tesouroTrustlineTxHash` já persistido, retorna 200 sem submeter.

**Por que não usar `idempotencyKey` no body:** o cliente pode falhar antes de gerar/enviar a chave. Idempotência server-side baseada no estado persistido é mais robusta — não depende do cliente cooperar.

**Por que não usar Serializable transaction:** os passos envolvem chamada externa (Horizon, Privy). Transações longas com hold em Postgres causam mais problemas do que resolvem. Idempotência por estado lido + writes pontuais é mais simples e suficiente — concorrência de duas submits pro mesmo investidor é cenário improvável (clientes serializam).

Swap (`/buy/swap/submit`): **não tocado**. Idempotência já existe via `quote.consumedAt` — bate 409 se quote foi consumido.

### F-12 — CPF dummy `'52998224725'`

**Arquivos:** `lib/format/parse-cpf.ts` (novo), `lib/services/investidor.ts`, `app/api/investidor/onboard/route.ts`

Estado pré-fix: todo onboarding chamava Etherfuse KYC com CPF hardcoded + PNG dummy. Funciona porque sandbox Etherfuse auto-aprova. Em produção (Etherfuse real + FIDC sob CVM 175): bloqueio Etherfuse imediato + responsabilidade legal — todo investor "real" teria a mesma identidade.

Solução:
- `parse-cpf.ts`: validador módulo 11 standard. Rejeita:
  - tamanho ≠ 11 dígitos (após strip de não-dígitos);
  - todos os dígitos iguais (`000.000.000-00`, `111...` etc — inválidos por construção);
  - dígitos verificadores incorretos.
  - Não-strings (incluindo `number`, `null`, `undefined`).
- `OnboardInput` ganhou `cpf?: string`.
- `investidor.ts`: branch `STELLAR_NETWORK === 'PUBLIC'` é proxy de "produção" (sem env dedicado `ETHERFUSE_MODE` por enquanto — alternativa registrada).
  - PUBLIC: `parseCpf(input.cpf)` é obrigatório. Falha → `throw new Error('cpf obrigatório em mainnet (válido por módulo 11)')`.
  - TESTNET: `parseCpf(input.cpf) ?? '52998224725'` — aceita CPF real se vier, senão dummy (preserva comportamento sandbox).
- Route `/api/investidor/onboard`:
  - Aceita `cpf` no body.
  - Erro com prefixo `"cpf obrigatório"` → 400; demais → 500.

**Por que `STELLAR_NETWORK` como proxy:** simples, sem env novo. Se aparecer cenário "testnet com Etherfuse real" no futuro, troca pra `ETHERFUSE_MODE` dedicado. Plano deixou ponto de extensão documentado.

**Não tocado neste bundle:** UI `/onboard` ainda não coleta CPF do investidor. Quando produção for habilitada, frontend precisa adicionar o campo. **O bundle pluga o ponto de extensão** — mainnet quebra explícito em vez de vazar identidade dummy.

**`DUMMY_PNG_BASE64` permanece nos uploads de docs/selfie:** documentos reais demandam mudança maior de produto (upload UI, storage seguro de PII). Fora do escopo deste fix — F-12 do audit é especificamente sobre CPF.

---

## Excluídos do bundle (gap já fechado)

### F-09 — `privyId @unique` faltando + email sintético

Schema (`prisma/schema.prisma:237`) já tem `privyId String? @unique` desde commits anteriores ao bundle low. Email sintético `${userId}@privy.plina.local` (`onboard/route.ts:41-43`) permanece, mas dedup é por `privyId` — colisão exigiria privyIds idênticos, impossível por construção Privy.

### F-13 — Lookup de events por email do JWT

F-02 (commit `bfc524e`, 6 PRs stacked) retrofitou `withAuth` em todas as rotas `app/api/investidor/**`. `events/route.ts:18-31` agora resolve via `user.investidorId` (mapeado de `privyId` no auth-guard), não por email.

---

## Métricas

- **+18 testes** (145 total, era 144 + tests existentes ajustados após refactor de mock):
  - `__tests__/services/pool-precision.test.ts` (6 testes — F-10)
  - `__tests__/lib/format/parse-cpf.test.ts` (14 testes — F-12)
  - `__tests__/lib/stellar/fund-account.test.ts` (4 testes — F-08)
  - `__tests__/api/investidor/buy/trust-plinarf/submit.test.ts` (7 testes — F-11 + retrocompat)
  - `__tests__/api/investidor/buy/trust-tesouro/submit.test.ts` (5 testes — F-11 + retrocompat)
- `pnpm typecheck` clean no escopo modificado (erros em `.next/types` e `scripts/smoke-etherfuse-iframe.ts` são pré-existentes, não tocados).
- `pnpm lint:auth-guard` clean.

---

## Diff resumido

```
M lib/services/pool.ts                                          (F-10)
M lib/services/realizacao.ts                                    (F-10)
M lib/services/originacao.ts                                    (F-10)
M lib/services/liquidacao.ts                                    (F-10)
M lib/services/investidor.ts                                    (F-12)
M lib/stellar/config.ts                                         (F-08)
M lib/stellar/account.ts                                        (F-08)
M app/api/investidor/onboard/route.ts                           (F-12)
M app/api/investidor/buy/trust-plinarf/submit/route.ts          (F-11)
M app/api/investidor/buy/trust-tesouro/submit/route.ts          (F-11)
+ lib/format/parse-cpf.ts                                       (F-12)
+ __tests__/services/pool-precision.test.ts                     (F-10, 6 testes)
+ __tests__/lib/format/parse-cpf.test.ts                        (F-12, 14 testes)
+ __tests__/lib/stellar/fund-account.test.ts                    (F-08, 4 testes)
M __tests__/api/investidor/buy/trust-plinarf/submit.test.ts     (F-11, +3 testes)
M __tests__/api/investidor/buy/trust-tesouro/submit.test.ts     (F-11, +1 teste)
```

---

## Próximos fixes do audit original

Cada um vira plano próprio (ordem por prioridade):

| ID | Severidade | Tema |
|---|---|---|
| F-04 | Alto | Admin auth via Clerk/Auth.js — substitui o tampão de F-24 |
| F-06 | Alto | MAC server-side sobre `distributorSigBase64` |
| F-07 | Alto | Reconciliação onramp → swap (job de detecção de fundos presos) |
| F-09 (audit) | Médio | Race em `distribute()` mock fora da `$transaction` |
| F-16 (audit) | Médio | Drop completo do KYC dummy (uploads reais + UI cpf) — bloqueador de mainnet |
| F-20 (audit) | Médio | Migrar secrets Stellar pra KMS antes da mainnet |
| F-27 | Baixo | Stub `app/api/investidor/liquidar/build/route.ts` ausente |
