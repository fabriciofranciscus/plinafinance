# Plano de migração do adaptador Etherfuse

> **Data:** 2026-08-18 · **Owner:** CTO (Thais)
> **Decisão de base:** manter o Etherfuse como anchor (2026-08-18). Ver
> [`ARQUITETURA-ALVO.md §2.3`](./ARQUITETURA-ALVO.md).
> **Fonte:** documentação viva da API do fornecedor, consultada em 2026-08-18.

## 1. Por que agora

Dois gatilhos independentes convergiram:

**O adaptador está quebrado.** O `lib/anchors/etherfuse/client.ts` chama endpoints com
sunset em **16/08/2026** — dois dias atrás — e três que já foram **removidos**. O caminho
afetado é o de onboarding e KYC, ou seja, a porta de entrada de `/investir` e `/vender`.

**O rail brasileiro será USDC↔BRL.** O fornecedor está construindo a ramp BRL sobre
**USDC**, não sobre TESOURO. Isso muda o ativo-ponte do produto e tem consequência
econômica, não só técnica — ver §3.

---

## 2. As cinco mudanças estruturais

Não é troca de URL. São cinco mudanças de modelo que atravessam o código.

### 2.1 O cliente virou uma organização

O `customer` deixa de ser criado por um endpoint de customer: passa a ser uma
**organização cujo UUID nós geramos**. Esse UUID é o `customer_id` em todo o resto da API
e o `sub` do JWT de launch.

```
POST /ramp/organization
{ id: <uuid gerado por nós>, displayName, accountType: 'personal'|'business',
  userInfo: { email, displayName } }
```

`userInfo.email` é **obrigatório** — é o endereço que o cliente confirma na verificação, e
não há outra fonte. Cliente sem e-mail não verifica.

### 2.2 PF e PJ passam por produtos diferentes

| | Cedente / comprador (PF) | Investidor institucional (PJ) |
|---|---|---|
| `accountType` | `personal` | `business` |
| Verificação | KYC | **KYB** |
| Superfície | `/verification/*` + launch `/idv` | launch `/kyb` — **sem API** |
| Webhook | `kyc_updated` | `kyb_updated` |
| Extras | — | cada UBO e representante legal faz KYC próprio; empresas-mãe recursivamente |

O patch `PLINA-MOD-001` fixa `accountType: 'business'` para todos. Passa a ser condicional
pelo papel.

### 2.3 Verificação é assíncrona e dirigida por requisitos

Toda submissão responde **`202 Accepted`** — "aceito, sendo aplicado", nunca "pronto". O
estado real chega por webhook ou pela leitura do breakdown de requisitos. A ordem é
obrigatória:

```
1. POST /ramp/organization                        cria a org
2. POST .../verification                          dados pessoais → 202
   ⤷ o roteamento por país é assíncrono; enviar documento antes → 409
   ⤷ esperar kyc_updated (not_started → in_progress)
3. GET  .../kyc?requirements=true                 lê o que falta
4. POST .../verification/documents                multipart real, só o que veio pending
5. POST .../verification/questionnaire            ocupação (código de industry)
6. launch /idv                                    e-mail + selfie + agreement
7. webhook kyc_updated → approved
```

Três requisitos **nunca** têm API: confirmação de e-mail, selfie de liveness e aceite do
customer agreement. Sempre terminam no widget.

**Armadilha:** um `202` seguido de requisito que continua `pending` significa que a
aplicação em background falhou. Chega um `kyc_updated` com `needsWork: true` e um
`userMessage` nomeando o que reenviar — **e esse par é point-in-time, não fica armazenado**.
`GET /kyc` não repete a mensagem depois. Sem webhook registrado, a informação se perde e só
resta reler os requisitos.

### 2.4 Upload deixa de ser base64

Hoje a Plina serializa imagem em data URL dentro de JSON (`ImagemDataUrl`, teto de 2 MB em
`app/api/conta/kyc/route.ts`). A API nova exige **`multipart/form-data` com arquivo de
verdade**. E **as duas faces de um documento vão na mesma requisição** — um lado sozinho é
recusado.

Isso muda a cadeia inteira: browser → nossa API → anchor.

### 2.5 O launch é por JWT, não por URL pré-assinada

`POST /ramp/onboarding-url` sai. Entra: assinar um JWT curto com `scope` e `sub` = id da
org, e o browser do cliente faz POST para `/auth/launch` com o `target`.

| Fluxo | `scope` | `target` |
|---|---|---|
| Verificação de identidade | `verification` | `/idv` |
| Verificação de empresa | `kyb` | `/kyb?org=<org_id>` |

> **`sub` errado não dá erro** — registra uma pessoa nova e a verificação não se liga ao
> nosso cliente. É falha silenciosa; validar em teste.
>
> Em iframe, a câmera exige `allow="camera *; microphone *"` **com o asterisco** — a forma
> simples não funciona porque o scanner roda em frame aninhado.

---

## 3. O ativo-ponte: parametrizar, não trocar

**Decisão: continuar com TESOURO.** É o que existe e o que funciona hoje; o rail USDC↔BRL
ainda está em construção. A entrega desta seção **não é migrar para USDC** — é deixar de
tratar o ativo-ponte como constante, para que a troca, se e quando acontecer, seja
configuração e não refactor.

```
hoje:     BRL --onramp--> TESOURO --swap atômico--> PLINARF
amanhã:   BRL --onramp--> <ponte> --swap atômico--> PLINARF     ← símbolo em configuração
```

Tecnicamente é barato: `lib/anchors/etherfuse/tesouro.ts` já resolve o ativo dinamicamente
via `GET /ramp/assets` (identificadores **diferem entre sandbox e produção** — nunca
hardcode). Vira `resolveBridgeAsset(symbol)`, com o símbolo em configuração. O custo real
está no que hoje nomeia TESOURO fora dele: a rota `/api/investidor/buy/trust-tesouro/*`, os
tipos do wizard e o texto das telas `claiming` e `confirm`.

### Quando (e se) trocar

TESOURO é **economicamente melhor** para este fundo, e essa é a preferência default:

**Manter TESOURO** enquanto o fornecedor o oferecer no rail BR. É denominado em BRL — ponte
cambialmente neutra para um FIDC com passivo e ativos em real — e ainda rende, o que
beneficia o caixa não aplicado do pool.

**Trocar para USDC** só se uma destas se confirmar: (a) o fornecedor descontinuar TESOURO no
rail brasileiro, ou (b) a trilha internacional (M4) mostrar que unificar a ponte compensa a
exposição cambial. É a pergunta 3 da Fase 0.

Se a troca vier, duas consequências econômicas que **não são decisão de engenharia**:

**Exposição cambial.** O fundo passaria a receber dólar sintético contra um NAV em reais.
Entre o on-ramp do investidor e a conversão existe risco de câmbio que hoje não existe. Ou
se converte imediatamente, ou se aceita e se faz hedge, ou se limita o tamanho da janela.
**Decisão do CEO/CTO, não do código.**

**Rendimento do caixa.** TESOURO rende; USDC não. O caixa não aplicado do pool
(`caixaRealizado` em `lib/services/pool.ts`) deixaria de render sozinho, o que entra no
cálculo de NAV e no yield-alvo da Sênior — que, aliás, segue sem ser fixado.

**Em contrapartida:** M4 ficaria mais simples. O investidor internacional já traz USDC; com
USDC como ponte, some a conversão dupla e a trilha internacional compartilha o mesmo caminho
do investidor BR a partir do swap.

---

## 4. Mapa endpoint a endpoint

| Hoje (`client.ts`) | Situação | Alvo |
|---|---|---|
| `POST /ramp/agreements/electronic-signature` :864 | **removido** | some — assinado dentro de `/idv` |
| `POST /ramp/agreements/terms-and-conditions` :879 | **removido** | some |
| `POST /ramp/agreements/customer-agreement` :894 | **removido** | some |
| `POST /ramp/onboarding-url` :404 | sunset 16/08 | `POST /ramp/organization` + JWT launch |
| `POST /ramp/customer/{id}/kyc` :832 | sunset 16/08 | `POST /ramp/customer/{id}/verification` |
| `POST /ramp/customer/{id}/kyc/documents` :851 | deprecado | `POST .../verification/documents` (multipart) |
| — | novo | `POST .../verification/questionnaire` (ocupação) |
| — | novo | `GET /ramp/verification/occupations` (códigos de `industry`) |
| `GET /ramp/customer/{id}/kyc/{pubkey}` :789 | ver nota | `GET /ramp/customer/{id}/kyc?requirements=true` |
| `POST /ramp/bank-account` :939 | ativo | validar contra `POST /ramp/customer/{id}/bank-account`, que é o caminho documentado; só depois da org aprovada |
| `GET /ramp/customer/{id}/bank-accounts` :628 | ativo | mantém |
| `POST /ramp/quote` :525 | ativo | mantém; `walletAddress` agora é **nativo** |
| `POST /ramp/order` :568 | ativo | mantém |
| `GET /ramp/order/{id}` :607 | ativo | mantém, mas deixa de ser o mecanismo primário |
| — | novo | `POST /ramp/webhook` (registro) + endpoint nosso |
| — | novo | `POST /ramp/order/{id}/regenerate_tx` (ver §7.2) |

> **Nota sobre status de KYC:** `GET /ramp/customer/{id}/kyc` **não** foi deprecado — é o
> caminho para manter. O que saiu foi `Wallet.kycStatus` / `kycOnChain`: verificação é
> organization-level, não per-wallet.

---

## 5. Mudanças na porta `Anchor`

A porta (`lib/anchors/types.ts`) está bem desenhada e sobrevive quase inteira. Ajustes:

| Método | Mudança |
|---|---|
| `createCustomer` | passa a aceitar `accountType: 'personal' \| 'business'` e a gerar/receber o UUID da org |
| `submitKyc` | deixa de ser uma chamada: vira `submitIdentity` / `submitDocuments` / `submitQuestionnaire`, todos com semântica `202` |
| `getKycRequirements` | assinatura muda de "por país" para **por cliente** — devolve a lista com `status` e `requiresLaunch` |
| `getKycUrl` | ⛔ sai. Entra `getLaunchToken(customerId, scope)` devolvendo o JWT assinado |
| `verifyWebhook` | 🆕 valida assinatura e normaliza o evento para um tipo interno |
| `resolveBridgeAsset` | 🆕 substitui `resolveTesouroAsset`, parametrizado por símbolo |
| `regenerateTransaction` | 🆕 renova XDR expirado |

Acrescentar às `AnchorCapabilities`: `requiresHostedLaunch`, `asyncVerification`,
`multipartDocuments`.

---

## 6. Schema e rotas novas

### 6.1 Prisma

| Modelo | Mudança |
|---|---|
| `Pessoa` | `etherfuseCustomerId` vira o UUID da org gerado por nós · novos: `orgAccountType`, `kycRequirementsJson` (último breakdown), `kycUserMessage` (o aviso point-in-time, que precisa ser persistido na chegada ou se perde) |
| `Investidor` | `kybOrganizationId`, `kybStatus`, `kybApprovedAt` |
| `WebhookEvento` 🆕 | `eventoId` 🔑 (dedupe), `tipo`, `payloadJson`, `assinaturaValida`, `processadoEm` — append-only |

### 6.2 Rotas

| Rota | Nota |
|---|---|
| `POST /api/webhooks/anchor` 🆕 | recebe `kyc_updated`, `kyb_updated`, `order_updated`, `swap_updated`, `bank_account_updated`. Verificação de assinatura obrigatória; idempotente por `eventoId`; responde rápido e processa fora do request |
| `GET /api/investidor/kyc/status` 🆕 | breakdown de requisitos para a UI de espera |
| `POST /api/investidor/kyc/launch` 🆕 | devolve o JWT de launch (`/idv` ou `/kyb`) |
| `POST /api/conta/kyc` 🔧 | multipart; deixa de retornar veredito, retorna estado |
| `POST /api/comprar/kyc` 🔧 | idem |
| `.../buy/trust-tesouro/*` 🔧 | renomear para `trust-bridge`, ativo por configuração |

---

## 7. Duas armadilhas que quebram em produção

### 7.1 Off-ramp e swap falham em silêncio

Se a carteira não existe on-chain, não tem ~1,5 XLM ou não tem a trustline do ativo
vendido, o fornecedor **não consegue montar a transação de burn — e não devolve erro nem
dispara webhook**. O pedido simplesmente nunca avança.

Isso é exatamente o sintoma que a página `/sacar` produziria: espera eterna. Antes de criar
qualquer ordem de saída, é obrigatório um **pré-check**: conta existe, saldo XLM suficiente,
trustline presente, endereço `G...` com checksum válido.

Só o **on-ramp** é sponsored: passando `walletAddress` na cotação, o fornecedor cria a conta,
adiciona a trustline, cobra isso na fee e entrega via claimable balance.

### 7.2 XDR expira em 1–2 minutos

As transações pré-montadas (burn, swap send, claim) vivem **1 a 2 minutos**. Submeter uma
velha devolve `tx_too_late` do Horizon. Não há tratamento disso no código hoje —
`regenerate_tx` não aparece em lugar nenhum do repositório.

O padrão recomendado é chamar `regenerate_tx` **a cada ~1 minuto** enquanto o usuário tem
uma transação aberta para assinar. Considerando que o investidor assina via Privy, com
possível confirmação por e-mail no meio, é praticamente certo que hoje transações expiram
em produção.

Caso especial: se o usuário transacionou na Stellar entre receber e reclamar o claimable
balance, o número de sequência do XDR de claim fica velho — mesmo `regenerate_tx` resolve.

---

## 8. Auditoria dos 7 patches

Boa parte do fork existe para suprir o que hoje é nativo. Reduzir a superfície de
manutenção é entrega desta migração.

| Patch | O que faz | Veredito |
|---|---|---|
| `PLINA-MOD-001` | `accountType: 'business'` fixo | 🔧 vira condicional por papel |
| `PLINA-MOD-002` | `walletAddress` no corpo da cotação | ⛔ **nativo e documentado** — remover patch |
| `PLINA-MOD-003` | `simulateCryptoReceived()` em sandbox | 🔍 existe superfície de sandbox própria; validar e provavelmente remover |
| `PLINA-MOD-004` | `pollOnRampUntilTerminal()` cobrindo indexação | ⛔ substituído por webhook |
| `PLINA-MOD-005` | tipos de conta PIX | ⛔ já marcado superado por 006 |
| `PLINA-MOD-006` | `transactionId` no registro de banco | 🔍 revalidar contra o endpoint per-customer |
| `PLINA-MOD-007` | claimable balance + XDR | ⛔ **nativo** (`stellarClaimableBalanceId` + `stellarClaimTransaction`) — remover patch, manter o fluxo |

Se a auditoria confirmar, sobram um ou dois patches — e aí vale reavaliar se o SDK precisa
continuar vendorizado ou se volta a ser dependência.

---

## 9. Fases de execução

### Fase 0 — Confirmar com o fornecedor *(bloqueia tudo)*

Perguntas que mudam o plano conforme a resposta:

1. Qual a data de GA da ramp **USDC↔BRL** e qual o pricing para BR?
2. O sandbox já expõe o par BRL↔USDC hoje, para desenvolvermos contra ele?
3. TESOURO continuará disponível como ativo na Stellar, ou o caminho BR é exclusivamente USDC?
4. KYB de investidor institucional: qual o prazo típico de aprovação? (entra no funil do roadshow como prazo)
5. Existe ambiente de teste para KYB, ou só produção?

### Fase 1 — Fundação, sem tocar no fluxo

- `POST /api/webhooks/anchor` com verificação de assinatura, dedupe e `WebhookEvento`
- registro do webhook no fornecedor
- `getLaunchToken()` na porta + assinatura do JWT
- migração do modelo de org (`createCustomer` → `POST /ramp/organization`)

**Aceite:** um evento de teste chega, é validado, persistido e não é reprocessado em entrega
duplicada.

### Fase 2 — KYC novo (PF)

- `submitIdentity` / `submitDocuments` / `submitQuestionnaire` com semântica `202`
- cadeia multipart de ponta a ponta (substitui data URL base64)
- tabela de `industry` via `GET /ramp/verification/occupations`
- máquina de estados de requisitos + UI de espera em `/investir` e `/vender`
- launch `/idv` ao final

**Aceite:** cedente completa KYC em sandbox pelo wizard da Plina, sem informar nada duas
vezes, e a aprovação chega por webhook.

### Fase 3 — KYB (PJ)

- org `business` no onboarding do investidor
- launch `/kyb?org=<id>`, acompanhamento por `kyb_updated`
- UI que comunica prazo, não formulário

**Aceite:** investidor institucional entra em KYB e o painel admin mostra o estágio.

### Fase 4 — Parametrizar o ativo-ponte

Continua rodando com **TESOURO**. O que muda é que ele deixa de estar cravado no código.

- `resolveBridgeAsset(symbol)` + configuração, com TESOURO como valor atual
- rota e UI de trustline renomeadas de `trust-tesouro` para `trust-bridge`
- telas `claiming` e `confirm` passam a exibir o nome do ativo vindo da configuração

**Aceite:** trocar o símbolo da ponte na configuração faz o fluxo completo rodar com outro
ativo em sandbox, sem alterar código.

### Fase 5 — Robustez

- pré-check de carteira antes de toda ordem de saída
- `regenerate_tx` em loop de ~1 min enquanto há XDR aberto
- tratamento explícito de `tx_too_late`

**Aceite:** um saque com 5 minutos de demora na assinatura conclui com sucesso.

### Fase 6 — Limpeza

- remover os patches confirmados como obsoletos
- decidir sobre a desvendorização do SDK
- atualizar `lib/anchors/README.md`, a §7 da `DOCUMENTACAO-TECNICA.md` e a §2.3 da
  `ARQUITETURA-ALVO.md`

---

## 10. O que não muda

Vale dizer explicitamente, para conter o escopo:

- A **porta `Anchor`** continua sendo a fronteira. Nada em `lib/services/` deve importar
  nada de `lib/anchors/etherfuse/`.
- O **swap atômico** TESOURO/USDC → PLINARF é código Plina, na Stellar, e não depende do
  fornecedor. Só o símbolo da perna 1 muda.
- **PII off-chain**, trilha `memo.hash`, idempotência e "DB depois da chain" seguem valendo.
- O **fluxo de claimable balance** permanece na experiência do investidor — deixa de ser
  patch nosso e passa a ser comportamento documentado do fornecedor.

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Rail USDC↔BRL não fica pronto a tempo | Fase 0 antes de qualquer código; sandbox como critério de partida |
| Exposição cambial BRL/USD no fundo | decisão explícita do CEO/CTO antes da Fase 4 |
| KYB institucional longo demais para o funil | medir na Fase 0; comunicar como prazo no roadshow |
| Verificação assíncrona degrada a conversão do `/vender` | UI de espera com estado real, não spinner; webhook em vez de polling |
| `userMessage` point-in-time perdido | persistir na chegada do webhook (§6.1) |
| Migração feita sobre sandbox e quebrada em produção | identificadores de ativo diferem entre ambientes — resolver sempre por `GET /ramp/assets` |
