# Vídeo de integração — bloco curl contra rotas Plina (caminho real)

> **Atualização 2026-05-20:** validado que o iframe Etherfuse funciona em sandbox e que `/api/investidor/buy/onramp/create` agora segue o **caminho real** (Etherfuse devolve `stellarClaimableBalanceId` + `stellarClaimTransaction` pré-assinada). O fallback mock (PLINA-MOD-005) só dispara se a bank account não estiver ativa.
>
> **Princípio do vídeo:** cada `curl` ataca uma rota `/api/investidor/*` que exercita `lib/services/*` (Privy + Etherfuse + Stellar + Postgres + audit). O único script "novo" é `scripts/video/iframe-helper.ts` — instrumentação pra abrir o iframe e pollar até bank ativa.

---

## 0. Pré-requisitos

### 0.1 Variáveis de ambiente (`.env.local`)

```bash
ETHERFUSE_ENV=sandbox
ETHERFUSE_API_KEY=<sandbox key>
ETHERFUSE_BASE_URL=https://api.sand.etherfuse.com
STELLAR_NETWORK=testnet
STELLAR_ISSUER_PUBLIC=<G...>
STELLAR_ISSUER_SECRET=<S...>
STELLAR_DISTRIBUTOR_SECRET=<S...>
ASSET_CODE=PLINARF
DATABASE_URL=postgresql://...
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
NEXT_PUBLIC_PRIVY_APP_ID=...
```

### 0.2 Dev server na porta 3002

```bash
npm run dev   # já default a -p 3002
```

Deixar rodando o vídeo inteiro num painel separado. Logs do servidor são parte da narrativa.

### 0.3 Source do helper de banner (pro vídeo mostrar qual arquivo Plina cada curl exercita)

```bash
source scripts/video/announce.sh
```

Define duas funções: `plina_announce "rota" "arquivo(s)" "prova"` e `plina_db "sql"`. Cada curl da timeline tem um `plina_announce` antes — o avaliador vê **rota → arquivo Plina** antes do request sair.

### 0.4 Capturar token Privy (uma vez, antes de REC)

1. Abrir `http://localhost:3002/investir` no Chrome/Firefox.
2. Login Privy (e-mail/Google).
3. DevTools (F12) → aba **Console** → colar:

   ```js
   copy(document.cookie.split('privy-token=')[1]?.split(';')[0])
   ```

4. No terminal de gravação:

   ```bash
   export PRIVY_TOKEN=<paste-aqui>
   ```

**Plano B:** DevTools → Application → Cookies → `http://localhost:3002` → copiar valor de `privy-token`.

**Sanity check:**

```bash
curl -sX POST http://localhost:3002/api/investidor/onboard \
  -H "Authorization: Bearer $PRIVY_TOKEN" \
  -H "Content-Type: application/json" -d '{"nome":"Teste"}' | jq
```

Se retornar JSON com `investidorId` e `publicKey`, ok. Token expira em ~1h.

---

## 1. Helper iframe (única peça nova legítima)

```bash
npx tsx scripts/video/iframe-helper.ts
```

**O que faz:**

1. `POST /api/investidor/onboard` → `lib/services/investidor.ts` orquestra Privy + Etherfuse + KYC + DB + audit (`INVESTIDOR_ONBOARDED`).
2. `anchor.getKycUrl` (instrumentação — chamada utilitária, não muda estado Plina).
3. `xdg-open` no presignedUrl → você preenche bank account no iframe da Etherfuse (sandbox aceita CLABE STP).
4. Polling em `/ramp/customer/.../bank-accounts` até `compliant=true`.
5. Grava `scripts/video/state.json` + imprime os `export` prontos pra copy-paste.

**Output esperado (último bloco):**

```
✓ HELPER OK · estado em scripts/video/state.json

  export INVESTIDOR_ID=cmpepvurq0000g9rzzfg6us29
  export PUBKEY=GCHBRBAW...
  export CUSTOMER_ID=131637ce-14dc-4ee6-8cfb-f2969efce3b7
  export BANK_ID=43b2aba0-6bfa-41b2-afcf-571f823d2db7
```

Copy-paste esses `export` no terminal. Os próximos passos são curl puro.

**Narrar:**

> "O onboarding institucional foi via API Plina, autenticado por Privy. Privy criou a carteira Stellar com custódia server-side, Etherfuse aprovou KYC programático (sandbox auto-aprova), e o investidor virou registro no Postgres com audit log de `INVESTIDOR_ONBOARDED`. Bank account é hosted-only por design da Etherfuse — abre uma janela de iframe, preencho chave PIX/CLABE, e o backend polla o webhook até detectar conta ativa."

---

## 2. Idempotência do onboard

```bash
plina_announce \
  "POST /api/investidor/onboard (2ª vez)" \
  "lib/services/investidor.ts:60-76 (early-return idempotente)" \
  "Mesmo investidorId — não duplica em retry de rede"

curl -sX POST http://localhost:3002/api/investidor/onboard \
  -H "Authorization: Bearer $PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Fundo Demo Video"}' | jq
```

Mesmo `investidorId`, sem duplicação no DB. `lib/services/investidor.ts:60-76` curto-circuita: se já existe Investidor com `etherfuseCustomerId` persistido e `status=AUTORIZADO`, devolve sem tocar Etherfuse de novo.

**Narrar:**

> "Idempotência forte: mesma chamada, mesmo `investidorId`. Sem chance de duplicar investidor mesmo em retry de rede."

---

## 3. Quote BRL → TESOURO (binding server-side)

```bash
plina_announce \
  "POST /api/investidor/quote" \
  "app/api/investidor/quote/route.ts → EtherfuseClient.getQuote + Prisma" \
  "Quote real Etherfuse persistido em Quote table (gap fechado 2026-05-18)"

QUOTE_RES=$(curl -sX POST http://localhost:3002/api/investidor/quote \
  -H "Content-Type: application/json" \
  -d "{
    \"amountBrl\":\"100\",
    \"customerId\":\"$CUSTOMER_ID\",
    \"stellarAddress\":\"$PUBKEY\"
  }")
echo "$QUOTE_RES" | jq
export QUOTE_ID=$(echo "$QUOTE_RES" | jq -r .quoteId)
```

**Resposta:**

```json
{
  "quoteId": "<uuid>",
  "fromCurrency": "BRL",
  "fromAmount": "100",
  "toCurrency": "TESOURO",
  "toAmount": "86.60...",
  "exchangeRate": "0.866...",
  "fee": "0.20",
  "expiresAt": "<iso>"
}
```

**O que aconteceu no backend:**

- `app/api/investidor/quote/route.ts` validou `customerId`, chamou `EtherfuseClient.getQuote`, **persistiu** o quote em `Quote` table com `Decimal(20,7)` — Phase 1 do binding (gap fechado 2026-05-18).

**Narrar:**

> "Quote real da Etherfuse, persistido no Postgres. Isso fecha o gap que a primeira versão tinha: a emissão de PLINARF depois deriva o `amount` server-side de `quote.toAmount` — investidor não consegue manipular o valor no body."

**Mostrar no DB:**

```bash
plina_db "
  SELECT id, \"fromAmount\", \"toAmount\", \"expiresAt\"
  FROM \"Quote\"
  WHERE id='$QUOTE_ID';"
```

---

## 4. OnRamp create — caminho real (sem mock!)

```bash
plina_announce \
  "POST /api/investidor/buy/onramp/create" \
  "app/api/investidor/buy/onramp/create/route.ts → anchor.createOnRamp + OnRampOrder" \
  "Bank ativa do iframe destrava caminho real (mock: false)"

ORDER_RES=$(curl -sX POST http://localhost:3002/api/investidor/buy/onramp/create \
  -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QUOTE_ID\"}")
echo "$ORDER_RES" | jq
export ORDER_ID=$(echo "$ORDER_RES" | jq -r .orderId)
```

**Resposta esperada (caminho real):**

```json
{
  "orderId": "<uuid>",
  "status": "pending",
  "paymentInstructions": {
    "type": "spei",
    "clabe": "646180615200003958",
    "bankName": "STP",
    "beneficiary": "Etherfuse",
    "amount": "100",
    "currency": "BRL"
  },
  "mock": false
}
```

**O que aconteceu no backend:**

- `app/api/investidor/buy/onramp/create/route.ts` validou quote, chamou `anchor.createOnRamp` com `bankAccountId` ativa, **não caiu no fallback mock** (porque bank é compliant), persistiu `OnRampOrder` 1:1 com `Quote`, gravou audit `ONRAMP_CRIADA`.

**Narrar (este é o ponto crítico):**

> "Aqui é o momento da verdade. Em versões anteriores caíamos num caminho mock auditável porque bank account era hosted-only e o sandbox não tinha como ativar. Agora — depois do iframe — `createOnRamp` segue o caminho real. `mock: false`. Veja `paymentInstructions.type: 'spei'` — a Etherfuse devolveu deposit instructions reais."

**Mostrar audit log:**

```bash
plina_db "
  SELECT acao, \"criadoEm\"
  FROM \"EventoAudit\"
  WHERE \"investidorId\"='$INVESTIDOR_ID'
  ORDER BY \"criadoEm\" DESC LIMIT 5;"
```

Esperado ver `ONRAMP_CRIADA` no topo, seguido de `INVESTIDOR_ONBOARDED`.

---

## 5. OnRamp status — simulação + poll até completed

> Em produção, o investidor pagaria PIX e Etherfuse confirmaria via webhook. Em sandbox, simulamos via `/sandbox-pay` (gated por `ETHERFUSE_ENV !== 'production'`).

```bash
plina_announce \
  "POST /api/investidor/buy/onramp/sandbox-pay" \
  "app/api/investidor/buy/onramp/sandbox-pay/route.ts (gated por ETHERFUSE_ENV)" \
  "Simula PIX + poll Etherfuse até completed (~30-60s)"

time curl -sX POST http://localhost:3002/api/investidor/buy/onramp/sandbox-pay \
  -H "Content-Type: application/json" \
  -d "{\"orderId\":\"$ORDER_ID\"}" | jq
```

A rota internamente chama `anchor.simulateFiatReceived` + `pollOnRampUntilTerminal`. Quando completar, ela atualiza `OnRampOrder.status = 'completed'` + grava audit `ONRAMP_LIQUIDADA`.

**Polling adicional (se sandbox-pay já não esperou):**

```bash
plina_announce \
  "GET /api/investidor/buy/onramp/status" \
  "app/api/investidor/buy/onramp/status/route.ts" \
  "Lê OnRampOrder do DB + pull Etherfuse se não-terminal"

curl -s "http://localhost:3002/api/investidor/buy/onramp/status?orderId=$ORDER_ID" | jq
```

Repetir até `status: "completed"`. Tempo típico: ~30s na sandbox.

**Resposta final:**

```json
{
  "orderId": "<uuid>",
  "status": "completed",
  "stellarTxHash": null,
  "mock": false,
  "paymentInstructions": { ... }
}
```

**Observação técnica:** a Etherfuse entrega TESOURO via **claimable balance** Stellar, não payment direto. O campo `stellarTxHash` no nosso wrapper fica null, mas a raw response da Etherfuse traz `stellarClaimableBalanceId` + `stellarClaimTransaction` (XDR pré-assinada). Pra ver:

```bash
# Acesso direto à Etherfuse pra inspecionar (instrumentação, não é produto):
ETHERFUSE_KEY=$(grep ETHERFUSE_API_KEY .env.local | cut -d= -f2)
curl -s "https://api.sand.etherfuse.com/ramp/order/$ORDER_ID" \
  -H "Authorization: $ETHERFUSE_KEY" | jq '.stellarClaimableBalanceId, .amountInTokens, .status'
```

E abrir no Stellar Expert:

```
https://stellar.expert/explorer/testnet/claimable-balance/<id>
```

**Narrar:**

> "Order completou. Etherfuse criou uma claimable balance no Stellar com TESOURO esperando o investidor reivindicar. Pra reivindicar, o investidor precisa de trustline TESOURO + assinar a tx de claim — esse passo precisa da custódia Privy no caminho real, e a Plina expõe isso via UI em `/investir`."

---

## 6. Audit log consolidado

```bash
plina_db "
  SELECT acao, \"criadoEm\", \"stellarTxHash\"
  FROM \"EventoAudit\"
  WHERE \"investidorId\"='$INVESTIDOR_ID'
  ORDER BY \"criadoEm\" ASC;"
```

Sequência esperada (ordem cronológica):

| `acao` | quando | tx Stellar |
|---|---|---|
| `INVESTIDOR_ONBOARDED` | onboard | — |
| `ONRAMP_CRIADA` | §4 | — |
| `ONRAMP_LIQUIDADA` | §5 (transição pra completed) | — |

**Narrar:**

> "Trilha de auditoria persistida em `EventoAudit`. Cada operação on-chain quando aplicável carrega o `stellarTxHash` correspondente. Auditor vê tudo, em ordem, com timestamps server-side."

---

## 7. UI segment — trustlines + swap (3 popups Privy)

> A partir daqui, abrir `http://localhost:3002/investir` no navegador. O resto é clique. **Justificativa técnica:** custódia Privy exige user gesture pra assinar tx Stellar (`useSignRawHash` é hook React client-side). Token JWT só autentica, não autoriza assinatura. Os 3 popups Privy são **prova visível de self-custody** — investidor revisa hash, confirma, on-chain.
>
> Layout da gravação dessa cena: **side-by-side com o terminal do `npm run dev`** — cada clique dispara request, log aparece em tempo real. Você narra "clique → log → on-chain".

### 7.1 Mapa de telas (`/investir`)

| # | Screen ID | O que aparece | Ação do dev | Backend disparado |
|---|---|---|---|---|
| 01 | `welcome` | "Plina Finance — testnet POC" + botão login | Login Privy (mesmo email já capturado) | — |
| 02 | `identity` | Pubkey + bloco "Trustlines · setup one-time" | Botão **"Configurar trustlines (2 assinaturas)"** → 2 popups Privy | `/trust-plinarf/{build,submit}` + `/trust-tesouro/{build,submit}` |
| 03 | `quote` | Input BRL + quote ao vivo | Botão **"Continuar"** | `/quote` (re-criado, ok) |
| 04 | `onramp` | SPEI instructions | Botão **"Já paguei via PIX"** | — |
| 05 | `settling` | Polling de status | Botão **"Simular PIX recebido"** | `/onramp/sandbox-pay` |
| 06 | `confirm` | Hash do swap envelope + checkbox | Checkbox "Revisei..." + botão **"Assinar e executar swap"** → 1 popup Privy | `/swap/{build,submit}` |
| 07 | `receipt` | "X PLINA-RF na sua wallet" + tx hash | — | — |

### 7.2 Roteiro clique-a-clique (com narração)

**Cena 7.1 — Welcome → Identity (10s)**

- Clica login se ainda não autenticado.
- Tela `identity` aparece com sua pubkey já listada (auto-onboard idempotente reusa o investidor que o helper criou).

> **Narrar:** "Abrir `/investir` autoboota o onboard — chama a mesma rota que o helper, e como é idempotente o backend reusa o investidor que já existe no DB. Pubkey aparece aqui."

**Cena 7.2 — Trustlines (20-30s, **2 popups Privy**)**

- Botão **"Configurar trustlines (2 assinaturas)"**. Texto muda pra "Aguardando assinatura Privy…".
- **Popup Privy #1** aparece com hash da trustline PLINARF. Apertar Confirmar.
- Texto continua "Aguardando assinatura Privy…" (loop chamando `/trust-plinarf/submit` + `getKycUrl`-like fluxo).
- **Popup Privy #2** aparece com hash da trustline TESOURO. Confirmar.
- Texto muda pra **"● trustlines configuradas"** em verde.

> **Narrar (popup 1):** "Privy mostra o hash exato da operação `ChangeTrust PLINARF`. Investidor revisa, assina. Hash sobe pra `/buy/trust-plinarf/submit` que primeiro submete a tx do investidor e depois o issuer autoriza com `AllowTrust` — duas operações que rodam server-side com chave do issuer guardada em `STELLAR_ISSUER_SECRET`."
>
> **Narrar (popup 2):** "Mesma mecânica pra TESOURO. Asset bridge da Etherfuse não tem `AUTH_REQUIRED` — trustline é ativa direto, sem co-assinatura do issuer da anchor."

Apontar no log do dev server:
- `[plina] POST /api/investidor/buy/trust-plinarf/build` ← retorna XDR
- `[plina] POST /api/investidor/buy/trust-plinarf/submit` ← submete + issuer authorize
- `[plina] POST /api/investidor/buy/trust-tesouro/build`
- `[plina] POST /api/investidor/buy/trust-tesouro/submit`

**Cena 7.3 — Quote + onramp + settling (30s, **sem popup**)**

- Botão **"Continuar para cotação"**.
- Screen `quote`: deixar o amount default (10.000 ou o que tiver). Botão **"Continuar"**.
- Screen `onramp`: mostra deposit instructions SPEI da Etherfuse. Botão **"Já paguei via PIX"**.
- Screen `settling`: polling até completar. Se sandbox, aparece botão **"Simular PIX recebido"** — clicar.
- Aguardar transição automática pra `confirm` (~30s).

> **Narrar:** "Repete o ciclo de quote → onramp via UI — mesmas rotas dos curls anteriores, agora disparadas por cliques. Logs do dev server mostram cada hit. O sandbox-pay completa o onramp em ~30s."

**Cena 7.4 — Confirm + swap atômico (15s, **1 popup Privy**)**

- Screen `confirm`: mostra XDR do envelope, pubkey destinatário, asset PLINA-RF, hash da tx.
- Marcar checkbox "Revisei o destinatário, o asset PLINA-RF e o hash da transação".
- Botão **"Assinar e executar swap"**.
- **Popup Privy #3** aparece com o hash do envelope atômico. Apertar Confirmar.
- Texto muda pra "Submetendo swap atômico…".
- Transição automática pra `receipt`.

> **Narrar (durante o popup):** "Esse é o crítico. Hash do envelope atômico Stellar — duas operações dentro da mesma tx: investidor manda TESOURO pro distributor, distributor manda PLINARF pro investidor. Atomicidade pelo protocolo Stellar — ou os dois lados se movem juntos, ou nada acontece. Distributor já tem sig pré-anexada server-side. Investidor co-assina e a tx vai pro Horizon."

Apontar no log:
- `[plina] POST /api/investidor/buy/swap/build` ← retorna `{xdr, hashHex, distributorSigBase64, mock:false}`
- `[plina] POST /api/investidor/buy/swap/submit` ← submete envelope, **consome quote** dentro de `db.$transaction`, audit `SWAP_EXECUTADO`

**Cena 7.5 — Receipt (15s)**

- Tela `receipt` aparece com:
  - Saldo PLINARF emitido (ex: `86.61 PLINA-RF`).
  - Tx hash do swap (clicável → Stellar Expert).
  - Block timestamp.

- Clicar no tx hash → abre Stellar Expert numa aba nova → mostra a tx com **2 operações `payment`** no mesmo envelope:
  - Op 1: investidor → distributor, TESOURO
  - Op 2: distributor → investidor, PLINARF

> **Narrar:** "Tx Stellar real, testnet pública. Anyone pode auditar. Duas operations no mesmo envelope, ordem cronológica fixa, ou commita junto ou rollback junto."

### 7.3 Pós-UI — confirmar audit chain completa via psql

Voltar pro terminal:

```bash
plina_db "
  SELECT acao, \"criadoEm\", \"stellarTxHash\"
  FROM \"EventoAudit\"
  WHERE \"investidorId\"='$INVESTIDOR_ID'
  ORDER BY \"criadoEm\" ASC;"
```

Sequência esperada agora (cronológica):

| # | `acao` | `stellarTxHash` |
|---|---|---|
| 1 | `INVESTIDOR_ONBOARDED` | — |
| 2 | `TRUSTLINE_AUTORIZADA` | tx do issuer `AllowTrust` |
| 3 | `TESOURO_TRUSTLINE_AUTORIZADA` | tx do investor `ChangeTrust TESOURO` |
| 4 | `ONRAMP_CRIADA` | — |
| 5 | `ONRAMP_LIQUIDADA` | — |
| 6 | `SWAP_EXECUTADO` | tx do envelope atômico (igual ao da Cena 7.5) |

> **Narrar:** "Audit chain completa, 6 eventos em ordem, cada um com timestamp server-side. Os 3 stellarTxHash batem com transações verificáveis no Horizon."

### 7.4 Rotas envolvidas (referência rápida)

| Rota | Quando | Audit `acao` |
|---|---|---|
| `/buy/trust-plinarf/build` | Cena 7.2 — popup #1 | — |
| `/buy/trust-plinarf/submit` | Cena 7.2 — após popup #1 | `TRUSTLINE_AUTORIZADA` |
| `/buy/trust-tesouro/build` | Cena 7.2 — popup #2 | — |
| `/buy/trust-tesouro/submit` | Cena 7.2 — após popup #2 | `TESOURO_TRUSTLINE_AUTORIZADA` |
| `/quote` | Cena 7.3 | — |
| `/buy/onramp/create` | Cena 7.3 | `ONRAMP_CRIADA` |
| `/buy/onramp/sandbox-pay` | Cena 7.3 — settling | `ONRAMP_LIQUIDADA` (via transição completed) |
| `/buy/swap/build` | Cena 7.4 — antes do popup #3 | — |
| `/buy/swap/submit` | Cena 7.4 — após popup #3 | `SWAP_EXECUTADO` |

---

## 8. Clawback (opcional, §6 do roteiro original)

`lib/stellar/issuer.ts` expõe `clawback()`. A rota `app/api/admin/clawback` (se existir) demonstra ao vivo. Pra vídeo, basta mostrar o código do issuer e citar o smoke `npm run smoke:stellar` que executa um clawback real testnet.

---

## 9. Sequência mínima copy-paste pra timeline reta

```bash
# 0. Token + dev server up + source do banner helper + DATABASE_URL no shell
export PRIVY_TOKEN=eyJ...
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
source scripts/video/announce.sh

# 1. Helper iframe (única peça nova; ele próprio já tem banners no output)
npx tsx scripts/video/iframe-helper.ts
# (preencher iframe, esperar polling detectar bank)
# Copy-paste os 4 exports (INVESTIDOR_ID, PUBKEY, CUSTOMER_ID, BANK_ID).

# 2. Idempotência do onboard
plina_announce \
  "POST /api/investidor/onboard (2ª vez)" \
  "lib/services/investidor.ts:60-76" \
  "Mesmo investidorId — early-return idempotente"
curl -sX POST http://localhost:3002/api/investidor/onboard \
  -H "Authorization: Bearer $PRIVY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Fundo Demo Video"}' | jq

# 3. Quote
plina_announce \
  "POST /api/investidor/quote" \
  "app/api/investidor/quote/route.ts → EtherfuseClient + Prisma" \
  "Binding server-side em Quote table"
QUOTE_RES=$(curl -sX POST http://localhost:3002/api/investidor/quote \
  -H "Content-Type: application/json" \
  -d "{\"amountBrl\":\"100\",\"customerId\":\"$CUSTOMER_ID\",\"stellarAddress\":\"$PUBKEY\"}")
echo "$QUOTE_RES" | jq
export QUOTE_ID=$(echo "$QUOTE_RES" | jq -r .quoteId)

plina_db "
  SELECT id, \"fromAmount\", \"toAmount\", \"expiresAt\" FROM \"Quote\" WHERE id='$QUOTE_ID';"

# 4. OnRamp create (caminho REAL — mock: false)
plina_announce \
  "POST /api/investidor/buy/onramp/create" \
  "app/api/investidor/buy/onramp/create/route.ts" \
  "Bank ativa do iframe destrava caminho real (mock: false)"
ORDER_RES=$(curl -sX POST http://localhost:3002/api/investidor/buy/onramp/create \
  -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QUOTE_ID\"}")
echo "$ORDER_RES" | jq
export ORDER_ID=$(echo "$ORDER_RES" | jq -r .orderId)

# 5. Sandbox-pay + status
plina_announce \
  "POST /api/investidor/buy/onramp/sandbox-pay" \
  "app/api/investidor/buy/onramp/sandbox-pay/route.ts (gated por ETHERFUSE_ENV)" \
  "simulateFiatReceived + poll → completed (~30-60s)"
time curl -sX POST http://localhost:3002/api/investidor/buy/onramp/sandbox-pay \
  -H "Content-Type: application/json" \
  -d "{\"orderId\":\"$ORDER_ID\"}" | jq

plina_announce \
  "GET /api/investidor/buy/onramp/status" \
  "app/api/investidor/buy/onramp/status/route.ts" \
  "Estado final da OnRampOrder no DB"
curl -s "http://localhost:3002/api/investidor/buy/onramp/status?orderId=$ORDER_ID" | jq

# 6. Audit
plina_db "
  SELECT acao, \"criadoEm\", \"stellarTxHash\"
  FROM \"EventoAudit\"
  WHERE \"investidorId\"='$INVESTIDOR_ID'
  ORDER BY \"criadoEm\" ASC;"

# 7. (UI) http://localhost:3002/investir → cliques de trustline + swap (3 popups Privy)
#   (logs do dev server mostram cada rota disparada; sem plina_announce nessa fase)

# 8. Audit final (após swap UI)
plina_db "
  SELECT acao, \"criadoEm\", \"stellarTxHash\"
  FROM \"EventoAudit\"
  WHERE \"investidorId\"='$INVESTIDOR_ID'
  ORDER BY \"criadoEm\" ASC;"
```

---

## 10. O que NÃO mostrar no vídeo

- Páginas `/investir` no browser **antes** da fase 7 — foi o erro do vídeo anterior.
- Detalhes de Privy login / iframe Etherfuse além dos 30s necessários — não é demo de UX da anchor.
- Pitch de mercado, comparação com concorrentes — avaliador quer ver integração.
- `.env*` ou secrets no terminal — `clear` antes de cada bloco.

## 11. O que mostrar com destaque

- **Logs do dev server** (`npm run dev`) durante cada `curl` — comprovam que `lib/services/*` está rodando, não é mock standalone.
- **Tabela `EventoAudit`** após o flow completo — prova persistência + ordenação cronológica.
- **`mock: false`** na resposta do `/onramp/create` — prova que o iframe destravou o caminho real.
- **Claimable balance no Stellar Expert** — prova que TESOURO real foi entregue.
