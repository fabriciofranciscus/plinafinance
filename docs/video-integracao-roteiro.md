# Vídeo de integração — passo a passo de gravação

> **Objetivo:** mostrar o fluxo backend de integração (âncora regulada Etherfuse + operações Stellar + persistência) sem depender da UI. Resposta direta à devolutiva: *"queremos avaliar o vídeo mostrando o fluxo da integração (âncoras, chamadas de contrato, etc., no backend mesmo)."*
>
> **Duração-alvo:** 6–8 minutos.
>
> **Princípio:** cada afirmação na narração precisa ter uma evidência visível na tela — log do servidor, tx hash no Stellar Expert, customer no Etherfuse dashboard, ou linha no Postgres. Sem slides longos.

---

## 0. Preparação (fazer ANTES de apertar REC)

### 0.1 Ambiente

```bash
# na raiz do projeto
cp .env.example .env   # se ainda não existir
# garantir que estão setados:
#   ETHERFUSE_API_KEY=<sandbox key>
#   ETHERFUSE_BASE_URL=https://api.sand.etherfuse.com
#   STELLAR_NETWORK=testnet
#   ISSUER_SECRET=<seed do issuer PLINA-RF testnet>
#   DATABASE_URL=postgresql://...
```

```bash
# reset limpo do DB pra logs ficarem legíveis
# OBS: o projeto guarda DATABASE_URL/DIRECT_URL em .env.local (padrão Next.js),
# mas o Prisma CLI só lê .env. Use dotenv-cli pra passar o arquivo certo:
npx dotenv -e .env.local -- npx prisma migrate reset --force
npx dotenv -e .env.local -- npx prisma generate
```

### 0.2 Pré-aquecer (rodar 1x antes pra cachear tudo)

```bash
npm run smoke:stellar    # confirma trilho Stellar verde
npm run smoke:etherfuse  # confirma trilho Etherfuse verde
```

Se algum falhar, **NÃO grave** — conserte antes. Os smokes são o sinal de saúde.

### 0.3 Layout de tela (gravar em 1080p ou maior)

Configurar 3 janelas, organizadas em "cenas" do OBS/Loom:

| Cena | Conteúdo |
|------|----------|
| **A — Código** | VS Code com 4 abas fixas (ver §0.4) |
| **B — Terminal** | 2 painéis lado a lado: esquerda `npm run dev` rodando, direita livre pra `curl`/`psql` |
| **C — Browser** | 3 abas: Stellar Expert (testnet), dashboard Etherfuse sandbox, `localhost:3000` (só pra mostrar que UI existe, sem usar) |

### 0.4 Abas do VS Code (deixar abertas, na ordem)

1. `lib/services/investidor.ts` — orquestração de onboarding
2. `lib/anchors/etherfuse/client.ts` — cliente da âncora
3. `lib/stellar/transactions.ts` — build/sign/submit das ops Stellar
4. `lib/stellar/issuer.ts` — autorização + clawback
5. `app/api/investidor/buy/swap/build/route.ts` + `submit/route.ts` — swap atômico
6. `app/api/investidor/liquidar/submit/route.ts` — liquidação

### 0.5 Mute o que não importa

- Fechar Slack, e-mail, notificações.
- Limpar tab title bar do terminal pra não vazar segredos.
- `clear` no terminal antes de cada bloco.

---

## 1. Cena de abertura (0:00 – 0:30)

**Mostrar:** VS Code, arquivo `README.md` ou um diagrama simples no quadro.

**Narrar:**
> "Esse vídeo cobre o fluxo de integração do investidor institucional da Plina. Vou rodar ponta-a-ponta: chamadas reais para a âncora Etherfuse (sandbox regulada), operações Stellar na testnet — trustline, path-payment atômico, clawback — e a persistência em Postgres com trilha de auditoria. Sem UI no caminho crítico."

**Mostrar no canto:** um diagrama de 1 slide (ASCII ou imagem):

```
Cliente API → Next.js route handler
                 ├─ Privy (custódia institucional)
                 ├─ Etherfuse (anchor SEP-equivalente, KYC + on/off-ramp)
                 ├─ Stellar Horizon (trustline, path-payment, clawback)
                 └─ Postgres (Investidor + EventoAudit)
```

---

## 2. Smoke Stellar — provar o trilho on-chain (0:30 – 2:00)

**Por que isso primeiro:** o smoke faz em ~1 minuto o ciclo completo Stellar e gera tx hashes reais pra abrir no Expert.

### 2.1 Mostrar o código

Abrir `scripts/smoke-stellar.ts`. Ler o header (os 7 passos numerados) em voz alta.

### 2.2 Rodar

```bash
npm run smoke:stellar
```

**Pausar a narração** enquanto o script roda (~30s) e deixar os logs aparecerem.

### 2.3 Apontar nos logs

Conforme o output aparece, apontar com o cursor:

- `✓ Issuer criado: G...` → "esse é o emissor do PLINA-RF"
- `✓ Flags AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED` → "isso é o que ERC-20 permissionless não entrega; é o requisito regulatório institucional"
- `✓ Trustline + autorização` → "trustline não é automática; o issuer autoriza explicitamente"
- `✓ Emissão PLINA-RF: tx <hash>` → **copiar hash**
- `✓ Clawback executado: tx <hash>` → **copiar hash**

### 2.4 Abrir tx hashes no Stellar Expert

No browser, abrir `https://stellar.expert/explorer/testnet/tx/<hash>` pra:

1. A tx de **emissão** — mostrar a operation `payment` saindo do issuer.
2. A tx de **clawback** — mostrar a operation `clawback` e o efeito de saldo zerado.

**Narrar:**
> "Esses são bytes reais na testnet pública. Qualquer um pode auditar."

---

## 3. Smoke Etherfuse — provar o trilho da âncora (2:00 – 3:30)

### 3.1 Mostrar o código

Abrir `scripts/smoke-etherfuse.ts`. Ler o header (9 passos: auth → KYC programático → quote → order → indexing grace).

### 3.2 Rodar

```bash
npm run smoke:etherfuse
```

### 3.3 Apontar nos logs

- `GET /ramp/me 200` → "autenticação na anchor regulada"
- `POST /ramp/onboarding-url` → "customer institucional criado, business account"
- `POST .../kyc + /documents + /agreements` → "KYC submetido via API — não é iframe, é integração programática"
- `Polling KYC ... approved` → "âncora aprovou"
- `POST /ramp/quote BRL → TESOURO` → "câmbio fiat → ativo Stellar"
- `POST /ramp/order` + `fiat_received` → "ordem on-ramp confirmada"

### 3.4 Abrir o dashboard Etherfuse sandbox

Browser → dashboard Etherfuse. Mostrar:
- O customer recém-criado.
- A order com status `completed`.

**Narrar:**
> "Do lado da âncora, o cliente está KYC-aprovado e tem TESOURO na carteira Stellar dele. Esse é o ponto onde fiat vira ativo on-chain de forma regulada."

---

## 4. Fluxo end-to-end via API (3:30 – 5:30)

Agora juntar os dois trilhos via Next.js routes — o que a UI consome.

### 4.1 Mostrar o serviço orquestrador

Abrir `lib/services/investidor.ts`. Ler o header (4 passos do onboarding) e percorrer rapidamente a função `onboardInvestidor`.

### 4.2 Onboard

No terminal direito:

```bash
curl -X POST http://localhost:3000/api/investidor/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Fundo Demo Institucional",
    "email": "demo@plina.finance",
    "tipo": "PJ"
  }'
```

No painel esquerdo (`npm run dev`), apontar nos logs do servidor:

1. Privy → `ensureStellarWallet` retorna publicKey.
2. Etherfuse → POST outbound pra `api.sand.etherfuse.com`.
3. Postgres → INSERT em `Investidor` com `status=AUTORIZADO`.
4. INSERT em `EventoAudit` (`INVESTIDOR_ONBOARDED`).

### 4.3 Trustlines

```bash
# substituir <PUBKEY> pelo publicKey retornado no passo anterior
curl -X POST http://localhost:3000/api/investidor/buy/trust-plinarf/build \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "<PUBKEY>"}'

curl -X POST http://localhost:3000/api/investidor/buy/trust-plinarf/submit \
  -H "Content-Type: application/json" \
  -d '{"signedXDR": "<XDR_DEVOLVIDO_POR_BUILD>"}'
```

Repetir pra `trust-tesouro`. Mostrar nos logs os 2 tx hashes; abrir 1 no Stellar Expert (a conta agora aparece com **2 trustlines**).

### 4.4 On-ramp (BRL → TESOURO)

```bash
curl -X POST http://localhost:3000/api/investidor/buy/onramp/create \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "<PUBKEY>", "amountBRL": 10000}'

# simula recebimento de PIX no sandbox
curl -X POST http://localhost:3000/api/investidor/buy/onramp/sandbox-pay \
  -H "Content-Type: application/json" \
  -d '{"orderId": "<ID_DA_ORDER>"}'

# poll até completed
curl http://localhost:3000/api/investidor/buy/onramp/status?orderId=<ID>
```

Abrir o dashboard Etherfuse → mostrar a order como `completed` e o TESOURO chegando na carteira.

### 4.5 Swap atômico (TESOURO → PLINA-RF) — o coração da entrega

Abrir `app/api/investidor/buy/swap/build/route.ts` e `submit/route.ts`. Apontar:

- A operação é **`PathPaymentStrictSend`** numa única tx.
- A tx é assinada por **investidor + issuer** (co-signer) — atomicidade garante que ou os dois lados se movem, ou nenhum.

```bash
curl -X POST http://localhost:3000/api/investidor/buy/swap/build \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "<PUBKEY>", "amountTesouro": "9800"}'

curl -X POST http://localhost:3000/api/investidor/buy/swap/submit \
  -H "Content-Type: application/json" \
  -d '{"signedXDR": "<XDR>"}'
```

Copiar o tx hash. Abrir no Stellar Expert → mostrar que a tx tem **2 efeitos atômicos**: investidor manda TESOURO, recebe PLINA-RF.

**Narrar:**
> "Atomicidade na liquidação é por que escolhemos Stellar nativo em vez de ERC-20 + DEX externa: ou os dois lados se movem na mesma operação, ou nada acontece."

---

## 5. Trilha de auditoria + idempotência (5:30 – 6:30)

### 5.1 Query no Postgres

No terminal direito:

```bash
psql $DATABASE_URL -c "SELECT id, tipo, \"createdAt\", \"txHash\" FROM \"EventoAudit\" ORDER BY id DESC LIMIT 10;"
```

Mostrar os eventos criados pelos passos anteriores, com os mesmos tx hashes que estão no Stellar Expert.

### 5.2 Idempotência

Re-rodar **o mesmo** curl de onboard do §4.2:

```bash
curl -X POST http://localhost:3000/api/investidor/onboard \
  -H "Content-Type: application/json" \
  -d '{"nome": "Fundo Demo Institucional", "email": "demo@plina.finance", "tipo": "PJ"}'
```

**Narrar:**
> "Mesmo payload, mesmo investidorId, sem duplicação. O `privyId` é unique no schema; requests duplicados retornam o mesmo registro. Não há janela pra desincronizar o estado entre Privy, Etherfuse e Postgres."

---

## 6. Liquidação + clawback (diferencial regulatório) (6:30 – 7:30)

### 6.1 Mostrar o código

Abrir `lib/services/liquidacao.ts` + `app/api/investidor/liquidar/submit/route.ts`. Narrar o fluxo:

1. Investidor envia PLINA-RF de volta para o issuer.
2. Issuer queima (ou guarda em distributor).
3. Etherfuse off-ramp TESOURO → BRL.
4. BRL cai na conta bancária PJ do investidor.

### 6.2 Mostrar a operação de clawback

Abrir `lib/stellar/issuer.ts`, scroll até a função de clawback.

**Narrar:**
> "Esse caminho é o que destrava o investidor institucional: existe uma operação nativa de clawback que o issuer pode disparar em caso de ordem judicial, congelamento CVM ou suspeita de PLD. Não é um hack em smart contract — é primitiva de protocolo Stellar. É o requisito que a CVM 175 espera ver."

Opcional: rodar `npm run smoke:audit` se houver tempo, pra mostrar a trilha de auditoria de um clawback real.

---

## 7. Fechamento (7:30 – 8:00)

**Narrar:**
> "Resumo do que vocês acabaram de ver: onboarding institucional com âncora regulada via API programática; trustlines com autorização explícita do issuer; on-ramp fiat→TESOURO; swap atômico TESOURO→PLINA-RF numa única transação Stellar; trilha de auditoria persistida com tx hashes verificáveis no Stellar Expert; e clawback nativo como controle regulatório. Tudo backend, sem UI no caminho crítico."

**Mostrar na tela:** uma última vez o `EventoAudit` populado lado a lado com o Stellar Expert e o dashboard Etherfuse.

---

## Checklist final antes de subir o vídeo

- [ ] Pelo menos **3 tx hashes** abertos no Stellar Expert durante o vídeo (emissão, trustline, path-payment, clawback — qualquer 3).
- [ ] **1 customer** visível no dashboard Etherfuse sandbox.
- [ ] **Logs do servidor** mostrando requests outbound pra `api.sand.etherfuse.com`.
- [ ] **Query SQL** rodada ao vivo na tabela `EventoAudit`.
- [ ] **Re-run idempotente** do onboard executado.
- [ ] Áudio claro; sem notificações; sem segredos visíveis (`.env`, chaves privadas no terminal).
- [ ] Resolução ≥ 1080p; fonte do editor ≥ 14pt pra ficar legível.

## O que NÃO mostrar

- Páginas `/investir`, `/comprar`, `/cessao` no browser — foi o erro do vídeo anterior.
- Tese de mercado, comparação com concorrentes, números do whitepaper — avaliador quer ver integração, não pitch.
- Slides longos. Máximo 1 diagrama de arquitetura.
- Qualquer arquivo `.env` ou secret no terminal — `clear` antes de cada bloco.

## Comandos prontos pra copy-paste durante a gravação

```bash
# Bloco 1 — Smokes
npm run smoke:stellar
npm run smoke:etherfuse

# Bloco 2 — Dev server (deixar rodando)
npm run dev

# Bloco 3 — Onboard
curl -X POST http://localhost:3000/api/investidor/onboard \
  -H "Content-Type: application/json" \
  -d '{"nome":"Fundo Demo Institucional","email":"demo@plina.finance","tipo":"PJ"}'

# Bloco 4 — Audit
psql $DATABASE_URL -c "SELECT id, tipo, \"createdAt\", \"txHash\" FROM \"EventoAudit\" ORDER BY id DESC LIMIT 10;"

# Bloco 5 — Clawback audit (opcional)
npm run smoke:audit
```
