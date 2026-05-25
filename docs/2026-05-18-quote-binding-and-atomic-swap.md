# 2026-05-18 — Quote binding + swap atômico

Fechamento do gap de emissão arbitrária de PLINA-RF identificado em `app/api/investidor/buy/submit/route.ts`. Trabalho organizado em duas fases sequenciais: **Phase 1** trava o valor de emissão server-side; **Phase 2** substitui o caminho single-shot por settlement on-chain real via Etherfuse onramp + envelope swap atômico.

---

## 1. Contexto — o gap

`/buy/submit` (rota legacy, agora removida) recebia do body:

```ts
{ xdr, investorPubkey, signatureHex, amount, investidorId? }
```

O XDR assinado pelo investor via Privy cobria **apenas** uma operação `ChangeTrust` (trustline PLINA-RF). A signature **não tocava** em valor de emissão, conta destino do payment, nem leg de pagamento da contraparte.

O backend então:
1. Submetia a trustline assinada pelo investor.
2. `authorizeTrustline` (issuer assina server-side).
3. `distribute(distributorSecret, ..., investorPubkey, amount)` — usando o `amount` **literal** do body.

**Resultado**: investor KYC-aprovado podia chamar `/buy/quote` com R$ 100, receber `toAmount: "100"`, e depois chamar `/buy/submit` com `amount: "10000000"` — server emitia 10M PLINARF. Quebrava invariante 1:1 NAV (whitepaper §6.5), cadeia de auditoria e framing regulatório (FIDC CVM 175).

Reportado verbalmente como:
> *amount confiável do cliente em buy/submit/route.ts:38-90 — XDR assinado prova apenas trustline; backend usa amount do body para distribute() PLINA-RF. Investidor pode pedir qualquer valor → emissão arbitrária. Fix: derivar amount do quote.id verificado server-side ou exigir leg de pagamento TESOURO no mesmo envelope.*

---

## 2. Decisões

### 2.1 Estratégia de fix — duas fases, ambas merged

| | Phase 1 (lift menor) | Phase 2 (doutrinário) |
|---|---|---|
| Mecanismo | Quote persistido; amount derivado de `Quote.toAmount` server-side | Envelope Stellar atômico com 2 legs: TESOURO investor→distributor + PLINARF distributor→investor |
| Fecha o gap? | Sim (binding) | Sim (settlement on-chain) |
| Exige TESOURO real | Não | Sim |
| Bypass sandbox | N/A | Mock quando bank account não está ativa |
| UX impact | Zero | +2 telas (onramp, settling), +2 sigs Privy (trustline TESOURO + envelope) |

Decisão: implementar **ambas**. Phase 1 fecha o gap imediatamente; Phase 2 amarra emissão a settlement econômico real, alinhado ao whitepaper §6.6.

### 2.2 Sandbox sem iframe — opção: mock bank-account-active

Etherfuse exige bank account PIX ativa pra `createOnRamp` funcionar. Registro PIX hoje só via iframe (PLINA-MOD-005). Três alternativas consideradas:

- **(a) Codificar fluxo correto, aceitar setup manual** — Phase 2 escreve rotas/UI assumindo bank ativa; E2E exige iframe one-time.
- **(b) Mockar bank-account-active em sandbox** ← **escolhida**
- **(c) Embedar iframe Etherfuse no /investir**

Escolha (b): sandbox detecta erro "Proxy account not found" no `createOnRamp`, cai em caminho mock com PIX fake (`__mock: true` no JSON da `OnRampOrder`). `/onramp/sandbox-pay` flipa status pra `completed` direto no DB. `/swap/build` em mock executa `distribute()` single-shot direto (sem TESOURO real na wallet). E2E sandbox roda end-to-end sem iframe.

Trade-off aceito: caminho mock vira código que coexiste com prod. Convenção `__mock` é visível em audit log e UI receipt ("mock sandbox · sem TESOURO on-chain"). Em produção, `ETHERFUSE_ENV !== 'sandbox'` desliga o caminho mock (`/onramp/sandbox-pay` retorna 403; `createOnRamp` jamais cai em mock).

### 2.3 Legacy routes — opção: substituir completamente

Alternativa rejeitada: coexistir `/buy/submit` legacy com `/buy/swap/*` novo atrás de flag `ETHERFUSE_FULL_FLOW`. Motivo da rejeição: dobra superfície de manutenção sem benefício — Phase 1 já fechou o gap funcionalmente; manter o single-shot só preservaria UX de 1-sig. Phase 2 reflow assume 2 sigs (trustlines) + 1 sig (envelope), e isso fica como o caminho canônico.

`/buy/build` + `/buy/submit` foram **deletados**. Substitutos:
- `/buy/trust-plinarf/{build,submit}` — trustline PLINARF + issuer authorize. Setup one-time, idempotente.
- `/buy/trust-tesouro/{build,submit}` — trustline TESOURO (asset bridge da Etherfuse). Setup one-time.
- `/buy/swap/{build,submit}` — emissão via envelope atômico co-assinado.

### 2.4 Frontend — opção: substituir telas

Mantida a estética Regulated Terminal (DESIGN.md). Telas antigas (welcome → identity → quote → confirm → receipt) viraram (welcome → identity → quote → onramp → settling → confirm → receipt). Trustlines setup virou subpasso da tela `identity` (botão "Configurar trustlines · 2 assinaturas"). Settling tem polling `/onramp/status` a cada 3s. Confirm mostra envelope swap com co-sig do distributor já anexada.

---

## 3. Implementação

### 3.1 Schema (migration `20260518200331_quote_onramp_envelope`)

```prisma
model Quote {
  id              String     @id          // UUID devolvido pelo Etherfuse
  investidorId    String                  // FK pra Investidor (resolvida via etherfuseCustomerId)
  fromCurrency    String
  fromAmount      Decimal    @db.Decimal(20, 7)
  toCurrency      String
  toAmount        Decimal    @db.Decimal(20, 7)
  exchangeRate    String
  fee             String
  expiresAt       DateTime
  consumedAt      DateTime?               // single-shot guard
  consumedTxHash  String?
  // ...
}

model OnRampOrder {
  id                      String     @id     // orderId Etherfuse (ou mock-UUID em sandbox bypass)
  quoteId                 String     @unique // 1:1 com Quote
  investidorId            String
  status                  String     @default("pending")
  stellarTxHash           String?            // tx Etherfuse → investor (TESOURO settled)
  paymentInstructionsJson Json?              // PIX/SPEI; campo __mock:true em sandbox bypass
  settledAt               DateTime?
  // ...
}

model Investidor {
  tesouroTrustlineTxHash  String?            // novo campo — Phase 2 setup
  // ...
}

enum AcaoAudit {
  // ...
  TESOURO_TRUSTLINE_AUTORIZADA
  ONRAMP_CRIADA
  ONRAMP_LIQUIDADA
  SWAP_EXECUTADO
}
```

### 3.2 Phase 1 — Quote binding

`app/api/investidor/quote/route.ts`:
- Lookup do investidor por `etherfuseCustomerId` (cliente não consegue spoofar `investidorId`).
- Persiste `Quote` row com `Decimal(20,7)` antes de devolver pro cliente.

`/buy/swap/{build,submit}` (também usado por Phase 2):
- Validação em camadas: quote existe → pertence ao `investorPubkey` → `consumedAt IS NULL` → `expiresAt > now`.
- `stellarAmount = quote.toAmount.toFixed(7)` — derivado server-side, body **não tem `amount`**.
- Consumo do quote dentro do `db.$transaction` do audit log + `Investidor.saldoEsperado` increment. `updateMany({ where: { consumedAt: null }})` + `count !== 1` ⇒ abort. Guarda contra dupla emissão concorrente.

### 3.3 Phase 2 — Atomic settlement

`lib/anchors/etherfuse/tesouro.ts` — resolve TESOURO asset (code + issuer) via `getAssets`, cacheado per-process. TESOURO issuer testnet documentado em ONBOARDING.md §5.8.

`/buy/onramp/create` — `Etherfuse.createOnRamp` → `OnRampOrder` persistida. Em sandbox, fallback mock se erro "Proxy account not found".

`/buy/onramp/status` — GET. Lê do DB; se não-terminal e não-mock, pulla Etherfuse e atualiza (status + `stellarTxHash`). Transição pra `completed` registra audit `ONRAMP_LIQUIDADA`.

`/buy/onramp/sandbox-pay` — gated por `ETHERFUSE_ENV !== 'production'`. Real: `simulateFiatReceived` + `pollOnRampUntilTerminal`. Mock: flip status no DB direto, `stellarTxHash = mock-stellar-<orderId>`.

`/buy/swap/build` — pré-condições: quote válido + `onRampOrder.status === 'completed'`.
- **Real**: usa `buildSwapBridgeForPlinarfXdr` (já existia em `lib/stellar/transactions.ts`). Distributor pre-signs via `preSignWithSecret`. Devolve `{ xdr, hashHex, distributorSigBase64, distributorPubkey, mock: false }`.
- **Mock**: server chama `distribute()` direto, consome quote atomicamente, devolve `{ txHash, mock: true, alreadyExecuted: true }`. Audit log marca `operador: 'sandbox-mock'`.

`/buy/swap/submit` — investor co-assina o hash via Privy. `submitWithPrivySignature` agora aceita `extraSignatures` (já existia) — distributor sig vai aí. Atomicidade Stellar: ambas legs commitam ou nenhuma. Quote consumido no mesmo `db.$transaction`.

### 3.4 Frontend `/investir`

7 telas (state `Screen`). Polling com `useEffect` no `settling`. Glossário inline expandido pra `swap atômico` e `onramp`. Receipt branch em `buyResult.mock` (label diferente: "Distribuição (mock sandbox)" vs. "Swap atômico").

`IdentityScreen` ganhou subpasso de trustlines: callback `setupTrustlines` faz duas chamadas Privy sequenciais (PLINARF, TESOURO). Disabled state propaga até o setup completar.

---

## 4. Limitações conhecidas

### 4.1 Mock sandbox não exercita atomicidade real

Em mock mode, o swap colapsa pra `distribute()` single-shot — a leg `investor→distributor TESOURO` não existe (investor não tem TESOURO). Atomicidade Stellar do envelope 2-legs **não é testada** em sandbox sem iframe. A propriedade de segurança "emissão depende de pagamento real" só vale em produção.

E2E specs cobrem **contratos** (guards de validação), não o happy path com Privy sig. Happy path sandbox requer setup de iframe one-time.

### 4.2 PLINARF trustline ainda assume distributor não-clawbackable nesta tx

`authorizeTrustline` é chamado server-side após `submitWithPrivySignature` em `/buy/trust-plinarf/submit`. Issuer + investor são partes distintas — o issuer autoriza, mas o investor não vê o `authorize` antes de assinar trustline. Em produção isso é tratável (issuer é a Plina, parte confiável). Vale revisitar se vier exigência regulatória de "investor revisa flags antes de assinar trustline".

### 4.3 Quote expiration UX

`Quote.expiresAt` vem da Etherfuse (~60s). Se o usuário demora na tela onramp/settling/confirm e o quote expira, `swap/submit` retorna 410. Frontend humaniza ("quote expirado — refaça a cotação") mas perde estado. Não tem auto-refresh de quote intermediário hoje.

### 4.4 Idempotência parcial em `/onramp/create`

Se `Quote.onRampOrder` já existe, devolvemos a order anterior (idempotente). Mas se o Etherfuse já criou a order e o write no DB falhou, a próxima chamada tenta criar de novo na Etherfuse — pode dar 409 ou criar duplicata. Tratar com retry + lookup por quoteId em chamada subsequente está pendente.

---

## 5. Próximos passos

| Item | Trigger | Doc futuro |
|---|---|---|
| Wire iframe Etherfuse no `/investir` pra eliminar caminho mock | Bank account PIX em sandbox via API (Etherfuse abrir o endpoint) **ou** ir pra prod | Atualizar este log + ONBOARDING.md §8 |
| Webhook Etherfuse pra evitar polling no `/onramp/status` | Volume de polling virar problema, ou prod requirements | Novo doc em `docs/` |
| Auto-refresh de quote intermediário em `/investir` | Reclamação real de UX | PR descritivo bastando |
| Idempotência forte em `/onramp/create` com lookup por quoteId externamente | Incidente real de duplicata | Pequeno PR |

---

## 6. Sincronização cruzada — ThaisFReis/Plina

Os dois repos do projeto divergiram estruturalmente: `ThaisFReis/Plina` (origin) é monorepo com Next.js em `plina-finance/`; `fabriciofranciscus/plinafinance` (onde o trabalho foi feito) tem o app no root. **Patches reescritos** com paths `plina-finance/<file>` estão em `exports/thaisfreis-patches/` (untracked) — ver README local pra apply.

Verificação byte-a-byte (2026-05-18) dos pré-existentes do working tree contra `origin/feat/investir-redesign:plina-finance/<file>`: 5/6 idênticos (`globals.css`, `layout.tsx`, `AppHeader.tsx`, `package.json`, `package-lock.json`); 1 (`lib/stellar/transactions.ts`) diverge em 2 linhas de comentário, código funcional igual.

**Estado de sincronização** (no momento do commit): `origin/main` está ~20 commits atrás de `fabricio/main`. Phase 1 aplica clean em `origin/feat/investir-redesign`; Phase 2 conflita em `ONBOARDING.md` (ainda não existe lá), `app/api/investidor/buy/submit/route.ts` e `app/investir/page.tsx` (versões anteriores no origin). Resolução documentada no README dos patches.

## 7. Arquivos materiais

- **Schema**: `prisma/schema.prisma`, migration `prisma/migrations/20260518200331_quote_onramp_envelope/`
- **Rotas novas**: `app/api/investidor/buy/{trust-plinarf,trust-tesouro,onramp,swap}/*/route.ts`
- **Quote persistence**: `app/api/investidor/quote/route.ts`
- **Helpers**: `lib/anchors/etherfuse/tesouro.ts`
- **Frontend**: `app/investir/page.tsx`
- **E2E**: `e2e/buy-quote-binding.spec.ts`, `e2e/buy-onramp-swap.spec.ts`
- **Removidos**: `app/api/investidor/buy/{build,submit}/route.ts`
