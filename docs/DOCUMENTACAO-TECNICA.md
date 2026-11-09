# Documentação Técnica — Plina Finance

> **Retrato do código como ele está.** Como o projeto está organizado, como os fluxos rodam,
> quais são as integrações, o modelo de dados e a referência de API. Para o **alvo** —
> arquitetura de destino, decisões abertas e o delta até lá — veja
> [`ARQUITETURA-ALVO.md`](./ARQUITETURA-ALVO.md); para produto e negócio,
> [`PRD-plina-v1.md`](./PRD-plina-v1.md); para design, [`DESIGN.md`](../DESIGN.md).
>
> **Verificado contra o repo em:** 2026-08-18 (branch `chore/function-region-gru1`, commit `6cb17a4`)

> **Qual documento manda em quê.** Três documentos descreviam decisão de arquitetura em
> paralelo, e listas paralelas divergem — foi assim que este aqui passou semanas afirmando que
> rotas eram públicas depois de o código as ter protegido. A regra passa a ser:
>
> | Pergunta | Documento |
> |---|---|
> | Como o código está **hoje** | **este** |
> | Como **deve** ficar, e por quê | [`ARQUITETURA-ALVO.md`](./ARQUITETURA-ALVO.md) |
> | **Quando**, e o que trava | [`PRD-plina-v1.md`](./PRD-plina-v1.md) §6 |
> | O que depende do CEO | [`DECISOES-CEO.md`](./DECISOES-CEO.md) |
>
> Onde este documento descrever decisão ou destino, ele está fora do papel dele — aponte para o
> alvo em vez de repetir. Onde os dois divergirem sobre o presente, **o código manda**, e o erro
> é deste arquivo.

## Índice

1. [Visão geral](#1-visão-geral)
2. [Stack e convenções](#2-stack-e-convenções)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Arquitetura](#4-arquitetura)
5. [Fluxos principais (mapa no código)](#5-fluxos-principais-mapa-no-código)
6. [Integração Stellar](#6-integração-stellar)
7. [Integração Etherfuse (anchor)](#7-integração-etherfuse-anchor)
8. [Autenticação e wallet](#8-autenticação-e-wallet)
9. [Modelo de dados](#9-modelo-de-dados)
10. [Referência de API](#10-referência-de-api)
11. [Decisões de arquitetura e segurança](#11-decisões-de-arquitetura-e-segurança)
12. [Observabilidade e segurança operacional](#12-observabilidade-e-segurança-operacional)
13. [Decisões estruturais e trade-offs de stack (por quê)](#13-decisões-estruturais-e-trade-offs-de-stack-por-quê)
14. [Deploy, configuração e runbooks](#14-deploy-configuração-e-runbooks)
15. [Design system (resumo)](#15-design-system-resumo)
16. [Como rodar e scripts](#16-como-rodar-e-scripts)
17. [Testes](#17-testes)
18. [Glossário](#18-glossário)
19. [Índice da documentação existente](#19-índice-da-documentação-existente)

---

## 1. Visão geral

A **Plina** é um **tokenizador institucional de direitos creditórios de consórcio
brasileiro**. Os direitos são adquiridos com deságio, agrupados em um veículo e representados
on-chain pelo token **PLINA-RF** (`PLINARF`) emitido na rede **Stellar**.

**Qual veículo depende da fase** (one-page do CEO, 2026-08-04): a **fase 01** — o MVP que vai a
mainnet — é operação privada sob a **Lei 11.795/2008**, financiada por capital próprio, e
**ninguém além da Plina detém PLINA-RF**. O **FIDC sob a Resolução CVM 175** e a distribuição a
investidores qualificados são a **fase 02**. Registro da decisão no
[Escopo da `ARQUITETURA-ALVO.md`](./ARQUITETURA-ALVO.md#decisão-de-escopo--quem-detém-plina-rf-na-fase-01).

- **Token Sênior:** `PLINARF` (classe `SENIOR`) — rendimento preferencial.
- **Token Subordinada:** `PLINARFB` (classe `SUBORDINADA`) — *skin-in-the-game* / absorção de risco.
- **Ativo-ponte:** `TESOURO` (Tesouro Direto tokenizado) entregue pelo anchor Etherfuse na
  entrada/saída de BRL via PIX.

O token é emitido com flags nativas de controle regulatório (`AUTH_REQUIRED`,
`AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`), permitindo *whitelisting* por KYC e clawback.

**Estágio atual:** POC funcional em **testnet** (Stellar testnet + sandbox Etherfuse) — com a
ressalva de que a integração com o anchor está **quebrada** desde 16/08 (§7) e o cálculo de
NAV/token tem defeito conhecido (§4).
O caminho para mainnet é dividido em fases **M0–M9** (fundação/segurança → vender →
comprar → investidor institucional BR → investidor internacional → ficha técnica →
compliance → waterfall Soroban → ops → cutover). Estado por fase em
[`docs/PRD-plina-v1.md`](./PRD-plina-v1.md).

**Fontes:** [`README.md`](../README.md), [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md).

---

## 2. Stack e convenções

| Camada | Tecnologia |
| --- | --- |
| Framework | **Next.js 16.2.4** (App Router) + **React 19.2.4** |
| Linguagem | **TypeScript** (strict) |
| Gerenciador | **pnpm** (`pnpm-lock.yaml`) |
| Estilo | **Tailwind CSS v4** *config-less* — tokens em `@theme` dentro de `app/globals.css` |
| Banco/ORM | **Prisma 6** + **Neon Postgres** (`DATABASE_URL` pooled, `DIRECT_URL` direto) |
| Blockchain | **@stellar/stellar-sdk 13** (Horizon, testnet/public) |
| Auth/Wallet | **Privy** (`@privy-io/react-auth`, `@privy-io/server-auth`) |
| On/Off-ramp | **Etherfuse** (SDK vendorizado, BRL↔TESOURO via PIX) — ⚠️ endpoints em sunset desde 16/08 e rail BRL ainda não é GA (§7) |
| Custódia (mainnet) | **em aberto** — três opções (guarda própria com multisig nativo, Fireblocks, custodiante equivalente); a fase 01 assume guarda própria. Ver [`ARQUITETURA-ALVO.md` §14.3](./ARQUITETURA-ALVO.md#14-decisões-pendentes) |
| Plataforma | **Vercel** — Blob (PDFs), Edge Config (feature flags), Analytics, Speed Insights, BotID |
| Rate-limit | **Upstash Redis** (`@upstash/ratelimit`) |
| Observabilidade | **OpenTelemetry** (`instrumentation.ts`, `instrumentation-client.ts`) |
| Validação | **Zod 4** |
| Testes | **Vitest** (unit, jsdom) + **Playwright** (e2e) |

> ⚠️ **Atenção (`AGENTS.md`):** esta versão do Next.js tem *breaking changes* em relação
> ao que você conhece. **Leia os guias em `node_modules/next/dist/docs/` antes de escrever
> código** — APIs, convenções e estrutura de arquivos podem diferir.

---

## 3. Estrutura de pastas

| Caminho | Conteúdo |
| --- | --- |
| `app/` | Rotas do App Router (telas públicas e fluxos autenticados) |
| `app/api/` | Route handlers REST (`admin`, `comprar`, `comprovante`, `conta`, `investidor`, `lab`, `pool`, `vender`) |
| `app/actions/` | Server Actions (submissões de formulário) |
| `app/investir/` | Fluxo do investidor: `page.tsx`, `_hooks/`, `_components/` (screens/shared/shell), `_lib/`, `_types.ts` |
| `lib/services/` | Lógica de negócio: `originacao`, `tokenizacao`, `investidor`, `liquidacao`, `realizacao`, `holdings`, `pool`, `pessoa` |
| `lib/stellar/` | Wrappers do SDK Stellar (config, transactions, account, signer, audit, fee, classes, issuer, parsers) |
| `lib/anchors/` | Porta `Anchor` (`types.ts`) + cliente Etherfuse vendorizado (`etherfuse/`) |
| `lib/wallet/` | Reconstrução de envelope Stellar + integração Privy server-side |
| `lib/auth/` | Auth admin por cookie + proteção CSRF |
| `lib/integrations/` | Stubs de terceiros: `psp/`, `fireblocks/`, `administradoras/`, `docusign/` |
| `lib/audit/`, `lib/email/`, `lib/comprovante/`, `lib/rate-limit/`, `lib/observability/`, `lib/env/`, `lib/format/`, `lib/http/` | Utilitários transversais |
| `lib/db.ts` | Cliente Prisma |
| `components/` | Componentes React de layout, landing e providers (`PrivyAppProvider`, `PessoaProvider`); `components/vender/` para o fluxo de venda |
| `prisma/` | `schema.prisma`, `migrations/`, `seed.ts` |
| `scripts/` | Smoke tests, backfills, `lint/require-auth-guard.mjs` |
| `e2e/` | Specs Playwright | `__tests__/` | Testes unitários Vitest |
| `docs/` | Documentação de produto, design, PRDs, runbooks e auditorias |

---

## 4. Arquitetura

**Padrão hexagonal-lite.** Os serviços em `lib/services/` dependem de uma **porta**
(interface) — `Anchor` em `lib/anchors/types.ts` — e nunca de uma implementação concreta. O
cliente Etherfuse em `lib/anchors/etherfuse/` é a única implementação existente.

> A afirmação de que "trocar o provedor de ramp é uma linha no adaptador" **não se sustentou** e
> saiu daqui. O contrato da porta foi derivado de um único fornecedor, com conceitos que não têm
> equivalente SEP — um anchor SEP em M4 vai forçar re-derivar o contrato, não plugar um
> adaptador. O alvo parte a porta em `Kyc` (com consumidor vivo) e `Ramp` (sem), dentro da
> migração do anchor: [`ARQUITETURA-ALVO.md` §7.1](./ARQUITETURA-ALVO.md#71-as-duas-portas-que-existem).

**Princípio "DB depois da chain".** O Postgres é tratado como **cache/registro**, não como
fonte da verdade: o estado canônico de saldos vive no **Horizon** (Stellar), e as gravações no
banco só ocorrem **após** o sucesso da operação on-chain. Ver
[`docs/M0-foundation-fase1.md`](./M0-foundation-fase1.md).

> ⚠️ **O princípio não vale para `/pool`, e isso é defeito conhecido.** `/minha-posicao` lê
> saldo do Horizon; **`/api/pool/summary` não consulta o Horizon em nenhum ponto**. O
> denominador do NAV/token vem de `tokensEmitidosVivos` (`lib/services/pool.ts:120`), que soma
> `tokensEmitidos` das cotas ativas no Postgres. Consequência: quando uma cota é realizada, o
> caixa entra no numerador **e** os tokens dela saem do denominador — conta dobrada — e com
> todas as cotas realizadas o cálculo devolve **0**, que é o valor com que
> `lib/services/liquidacao.ts:94` precificaria um resgate. A correção está especificada em
> [`ARQUITETURA-ALVO.md` §8.2](./ARQUITETURA-ALVO.md#82-publicação-de-nav) e é o item 6 da fila.

**Camadas:**

```
app/ (UI + route handlers)
  └─ lib/services/ (regras de negócio)
       ├─ lib/stellar/  → Horizon / XDR / assinatura
       └─ lib/anchors/  → porta Anchor → Etherfuse (on/off-ramp)
            ⇅
        prisma (cache / trilha)
```

---

## 5. Fluxos principais (mapa no código)

### Investir — `/investir`

Wizard de ~10 telas orquestrado por **`app/investir/_hooks/use-investir-flow.ts`**, que
compõe hooks especializados (todos em `app/investir/_hooks/`):

`use-onboard.ts` · `use-trustlines.ts` · `use-banking.ts` · `use-quote.ts` ·
`use-onramp.ts` · `use-claim.ts` · `use-swap.ts`

Telas em `app/investir/_components/screens/`: `welcome → identity → banking → classe →
quote → onramp → settling → claiming → confirm → receipt`. Shell (rail, transições, banner
de testnet, bloco de erro) em `_components/shell/`.

**Cadeia ponta a ponta:**

1. Login Privy (email/OAuth) → carteira Stellar embarcada.
2. KYC + autorização de **trustline** para `PLINARF`/`TESOURO` (issuer tem `AUTH_REQUIRED`).
3. Registro de conta PIX no Etherfuse (`/api/investidor/bank-account/register`).
4. Escolha de classe (`SENIOR`/`SUBORDINADA`).
5. **Quote** BRL→TESOURO (`/api/investidor/quote`) — persistida server-side.
6. **On-ramp** PIX (`/api/investidor/buy/onramp/create`), com polling de status
   (`.../onramp/status`) e simulação em sandbox (`.../onramp/sandbox-pay`).
7. (Opcional) **Claim** de claimable balance de TESOURO (`/api/investidor/buy/claim/*`).
8. **Swap atômico** TESOURO→PLINARF (`/api/investidor/buy/swap/build` + `/submit`).
9. `receipt` com hash da transação e link para o Stellar Expert.

Rotas de saída/liquidação: `/api/investidor/liquidar/{quote,build,submit}` e
`/api/investidor/buy/offramp/*`.

### Minha posição — `/minha-posicao`
Lê o saldo do investidor **diretamente do Horizon** e projeta rendimento.

### Pool — `/pool`
Dashboard público de composição: NAV, supply do token e *caixa*, lidos do Horizon, com
link de auditoria no Stellar Expert. API: `/api/pool/summary`. Serviço: `lib/services/pool.ts`.

### Vender — `/vender`
Wizard para o **cedente** (cotista que vende seu direito): login + KYC (uma vez,
`/api/conta/kyc`), depois submissão da cota (tipo do bem, valor de face, administradora) →
`/api/vender/simular` (faixas de deságio) → `/api/vender/lead`. Acompanhamento assíncrono
em `app/vender/acompanhar/[leadId]/` (sem auth; `leadId` é token opaco). Aceite da oferta:
`/api/vender/aceitar-oferta`. Componentes em `components/vender/`.

### Comprar — `/comprar`
Funil do comprador-usuário: calculadora comparativa, captura de lead
(`/api/comprar/lead`) e reserva de cota por 72h (`/api/comprar/reservar`).

### Admin — `/admin`
Painel operacional (auth por cookie): originação de cota (`/api/admin/originacao`),
realização/liquidação (`/api/admin/realizacao`), clawback e trilha de auditoria.

---

## 6. Integração Stellar

Arquivos em `lib/stellar/`:

| Arquivo | Responsabilidade |
| --- | --- |
| `config.ts` | Rede (testnet/public), código do ativo, chaves de issuer/distributor |
| `transactions.ts` | Construção de XDR (trustline, swap, liquidação) |
| `account.ts` | Cliente Horizon, carregamento de conta, montagem de assets |
| `signer.ts` | Porta `StellarSigner` + assinatura do distributor (server-side) |
| `audit.ts` | Trilha on-chain via `memo.hash` |
| `fee.ts` | Cálculo dinâmico de fee | `classes.ts` | Mapeamento das classes |
| `issuer.ts`, `parse-swap-xdr.ts`, `parse-liquidacao-xdr.ts`, `log-error.ts` | Suporte |

**Trustline.** O backend constrói o XDR; o frontend assina o hash via Privy
(`signRawHash`); o backend submete ao Horizon. Como o issuer tem `AUTH_REQUIRED`, a
trustline precisa ser autorizada antes de receber o token.

**Swap atômico (TESOURO → PLINARF).** Uma única transação com **duas pernas**:
(1) investidor → distributor envia `TESOURO`; (2) distributor → investidor envia `PLINARF`.
O investidor assina a sua operação via Privy; o distributor assina server-side; o backend
combina as assinaturas e submete. Isso elimina risco de slippage e garante atomicidade.
Detalhe em [`docs/2026-05-18-quote-binding-and-atomic-swap.md`](./2026-05-18-quote-binding-and-atomic-swap.md).

**Trilha de auditoria.** Cada transição de estado registra um `memo.hash` (SHA-256 do
payload JSON) on-chain via self-payment — provendo proveniência verificável.

**Clawback.** O issuer é configurado com `AUTH_CLAWBACK_ENABLED`. A política pública está
em `/politica-clawback`, com **4 hipóteses exclusivas** (decisão judicial, sanção
regulatória, fraude documental, erro operacional) — modeladas no enum `MotivoClawback`.

---

## 7. Integração Etherfuse (anchor)

> 🔴 **Esta integração está quebrada em produção.** Três endpoints usados pelo código foram
> **removidos** da API do fornecedor e outros estão em **sunset desde 16/08/2026**; o KYC deixa
> de ser síncrono e passa a chegar por webhook. Além disso, o **rail BRL ainda não é GA** — a
> documentação do fornecedor lista Brasil como *Upcoming*, e o único mercado live é o México. O
> que segue descreve o código **como ele está**, não como ele funciona hoje contra a API real.
> Diagnóstico completo em [`ARQUITETURA-ALVO.md` §2.3](./ARQUITETURA-ALVO.md#23-anchor--etherfuse)
> e plano de execução em [`PLANO-MIGRACAO-ANCHOR.md`](./PLANO-MIGRACAO-ANCHOR.md).
>
> Consequência de escopo: como o motor de originação da fase 01 (`/vender`, `/comprar`) opera por
> PIX off-chain e **não passa pelo anchor**, o rail BRL saiu do caminho crítico de mainnet. O que
> **continua** na fase 01 é o KYC de pessoa física — cedente e comprador.

O SDK do Etherfuse é **vendorizado** em `lib/anchors/etherfuse/` (origem: regional-starter-pack,
Apache-2.0) e exposto à aplicação através da porta `Anchor` (`lib/anchors/types.ts`).

Há **7 patches Plina** aplicados ao SDK, documentados de forma canônica em
[`lib/anchors/README.md`](../lib/anchors/README.md). Resumo:

| Patch | O que faz |
| --- | --- |
| PLINA-MOD-001 | `accountType: 'business'` no customer/KYC |
| PLINA-MOD-002 | `walletAddress` no corpo da quote (cálculo de fee) |
| PLINA-MOD-003 | `simulateCryptoReceived()` para off-ramp em sandbox |
| PLINA-MOD-004 | `pollOnRampUntilTerminal()` cobre janela de indexação de 3–10s |
| PLINA-MOD-006 | injeção de `transactionId` no registro de banco PIX (API em vez de só iframe) |
| PLINA-MOD-007 | `ClaimableBalance` ID + XDR para o modelo de pagamento TESOURO |

> Para o detalhe de cada patch, **consulte `lib/anchors/README.md`** — é a fonte de verdade.

---

## 8. Autenticação e wallet

**Privy.** Wrapper em `lib/hooks/privy.tsx`, provider em `components/PrivyAppProvider.tsx`:

- Login por **email** (envio de código) e **OAuth** (Google).
- **Assinatura raw-hash Ed25519** (`useAppSignRawHash`) — usada para assinar XDRs Stellar.
- **Modo stub** para e2e (`NEXT_PUBLIC_E2E_PRIVY_STUB`): keypair semeada via localStorage,
  evitando o provedor real nos testes.

**PessoaProvider** (`components/PessoaProvider.tsx`). Contexto React de conta/KYC
compartilhado entre o header e o fluxo `/vender`. Expõe
`{ authenticated, pessoaId, nome, email, kycAprovado, kycStatus, papeis, refresh }` e busca
`/api/conta/me` no login.

**Admin.** Autenticação por cookie em `lib/auth/admin.ts`, com proteção CSRF em
`lib/auth/admin-csrf.ts`.

---

## 9. Modelo de dados

Schema em `prisma/schema.prisma`. PII **off-chain** (Postgres, Brasil); on-chain só hashes,
endereços e timestamps (whitepaper §9, LGPD).

### Diagrama de relações (principais)

```
Pessoa ──1:1── Investidor ──1:N── Quote ──1:1── OnRampOrder
  │  (privyId,                │              └─1:1── OffRampOrder
  │   email,                  ├──1:N── HoldingPLINARF  (por classe SENIOR/SUBORDINADA)
  │   publicKey,              └──1:N── EventoAudit
  │   kycStatus)
  │
  ├──1:N── LeadVendedor ──1:N── Oferta ──1:1── Cessao ──1:1── Pagamento
  │                                                  └──1:1── Cota ──1:1── RealizacaoCaminho
  │
  └──1:N── LeadComprador ──1:N── Reserva ──1:1── CessaoComprador
                   └──1:N── RealizacaoCaminho                 (└─ ancorada na Reserva)

EventoAudit  ── polimórfico → cotaId · investidorId · leadVendedorId · ofertaId ·
                cessaoId · leadCompradorId · cessaoCompradorId  (trilha append-only)
ParametrosPool ── singleton (id="singleton"): issuer/distributor, rede, assetCode
NavSnapshot · JanelaLiquidez · PrestadorRegulado · AdminSession · WalletProvisioning ·
LiquidacaoSubmit ── operacionais / extensões PRD
```

### Glossário de enums (completo)

| Enum | Valores |
| --- | --- |
| `TipoBem` | `IMOVEL` · `VEICULO` · `EQUIPAMENTO` · `SERVICO` |
| `StatusEstoque` | `VERDE` (0–45d) · `AMARELO` (46–75d) · `VERMELHO` (76–90d) · `BAIXA` (90+d) |
| `StatusCota` | `DISPONIVEL` · `RESERVADA` · `REALIZADA` · `REVERTIDA` |
| `MotivoClawback` | `DECISAO_JUDICIAL` · `SANCAO_REGULATORIA` · `FRAUDE_DOCUMENTAL` · `ERRO_OPERACIONAL` (4 hipóteses exclusivas, whitepaper §6.5) |
| `ClassePLINARF` | `SENIOR` (code `PLINARF`, yield preferencial) · `SUBORDINADA` (code `PLINARFB`, *skin-in-the-game*) |
| `CaminhoCessao` | `API_ADMINISTRADORA` (SLA B2B preferencial) · `CARTORIO_DIGITAL` (fallback, taxa de anuência 100–300 bps) |
| `TipoInvestidor` | `INST_BR_QUALIFICADO` · `INST_BR_PROFISSIONAL` · `INST_INTERNACIONAL_PROFISSIONAL` |
| `StatusInvestidor` | `PENDENTE_KYC` · `AUTORIZADO` · `REVOGADO` (fase do onboarding; ortogonal a `KycStatus`) |
| `KycStatus` | `NAO_INICIADO` · `PENDENTE` · `APROVADO` · `REJEITADO` (por `Pessoa`, feito uma vez, compartilhado entre papéis) |
| `Papel` | `INVESTIDOR` · `CEDENTE` · `COMPRADOR` |
| `CaminhoRealizacao` | `A_REVENDA` (foco do POC) · `B_ADMINISTRADORA` · `C_PRAZO_GRUPO` (whitepaper §6.2) |
| `AcaoAudit` | Eventos de auditoria, por grupo: **pool/investidor** (`COTA_VALIDADA`, `COTA_INCORPORADA`, `TOKEN_EMITIDO`, `INVESTIDOR_ONBOARDED`, `TRUSTLINE_AUTORIZADA`, `TRUSTLINE_REVOGADA`, `DISTRIBUICAO`, `CLAWBACK_EXECUTADO`, `COTA_REALIZADA`); **funil vendedor** (`CEDENTE_ONBOARDED`, `LEAD_VENDEDOR_CAPTURADO`, `OFERTA_GERADA`, `OFERTA_ACEITA`, `CESSAO_ASSINADA`, `PIX_SIMULADO_EXECUTADO`); **funil comprador** (`LEAD_COMPRADOR_CAPTURADO`, `RESERVA_CRIADA`, `RESERVA_CANCELADA`, `RESERVA_EXPIRADA`, `KYC_COMPRADOR`, `CESSAO_COMPRADOR_ASSINADA`, `CAMINHO_A_EXECUTADO`); **liquidação** (`PLINARF_LIQUIDADO`); **fase-2 onramp** (`TESOURO_TRUSTLINE_AUTORIZADA`, `ONRAMP_CRIADA`, `ONRAMP_LIQUIDADA`, `OFFRAMP_CRIADA`, `OFFRAMP_BURN_ASSINADO`, `OFFRAMP_PROCESSANDO`, `BANK_ACCOUNT_REGISTRADA`, `CLAIMABLE_BALANCE_RESGATADA`, `SWAP_EXECUTADO`); **N-09** (`WALLET_FUNDED`); **M3** (`SUITABILITY_PREENCHIDA`, `TICKET_MINIMO_REJEITADO`, `ENTIDADE_PREENCHIDA`) |
| `LeadVendedorStatus` | `NOVO` · `CONTATADO` · `DOCS_SOLICITADOS` · `DOCS_RECEBIDOS` · `OFERTA_ENVIADA` · `OFERTA_ACEITA` · `CESSAO_ASSINADA` · `PIX_EXECUTADO` · `COTA_INCORPORADA` · `PERDIDO` |
| `OfertaStatus` | `RASCUNHO` · `ENVIADA` · `ACEITA` · `REJEITADA` · `EXPIRADA` |
| `CessaoStatus` | `PENDENTE` · `ENVIADA_DOCUSIGN` · `ASSINADA` · `EXPIRADA` · `CANCELADA` |
| `PagamentoStatus` | `PENDENTE` · `EXECUTADO` · `FALHOU` |
| `PagamentoMetodo` | `PIX_SIMULADO` (testnet) · `PIX_REAL` (mainnet) |
| `LeadCompradorTipo` | `PESSOA_FISICA` · `PESSOA_JURIDICA` |
| `LeadCompradorStatus` | `NOVO` · `QUALIFICADO` · `RESERVOU` · `FECHOU` · `PERDIDO` |
| `ReservaStatus` | `ATIVA` · `EXPIRADA` · `CONFIRMADA` · `CANCELADA` |

### Modelos — Pool & Investidor

| Modelo | Propósito | Campos-chave |
| --- | --- | --- |
| `ParametrosPool` | Singleton com parâmetros do issuer/asset | `id`=`"singleton"` · `assetCode` · `issuerPubkey` · `distributorPubkey` · `homeDomain` · `policyUrl` · `network` (TESTNET/PUBLIC) |
| `Pessoa` | Identidade unificada; KYC uma vez, compartilhado entre papéis | `id` · `privyId` 🔑 · `email` 🔑 · `nome` · `publicKey` 🔑 · `kycStatus` · `etherfuseCustomerId` · `etherfuseBankAccountId` · `cpfNormalizado` · `isSyntheticCpf` · `papeis[]` |
| `Investidor` | Investidor onboarded (1:1 com Pessoa) | `id` · `pessoaId` 🔑→Pessoa · `publicKey` 🔑 · `status` (`StatusInvestidor`) · `tipo` (`TipoInvestidor`) · `trustlineTxHash` · `tesouroTrustlineTxHash` · `saldoEsperado` · `jurisdicao` · `razaoSocial` · `cnpj` · `enderecoEntidade` (JSON) · `ticketMinimoCheck` · `suitabilityJson` (CVM 30) |
| `Cota` | Direito creditório de consórcio (estoque) | `id` · `tipoBem` · `administradora` (não exposta publicamente) · `valorCarta` · `desagioAquisicao` · `desagioRevenda` · `statusEstoque` · `status` (`StatusCota`) · `tokensEmitidos` · `emissaoTxHash` · `hashValidacao` (SHA-256 do laudo, on-chain) · `validacaoTxHash` · `cessaoId` 🔑→Cessao |
| `Quote` | Cotação on/off-ramp Etherfuse (single-shot) | `id` (UUID Etherfuse) · `investidorId` · `fromCurrency`/`toCurrency` · `fromAmount`/`toAmount` · `exchangeRate` · `fee` · `expiresAt` · `classe` (default `SENIOR`) · `consumedAt` · `submitXdrHash` 🔑 (idempotência C-04) |
| `OnRampOrder` | Liquidação BRL→TESOURO (PIX off-chain → pagamento on-chain) | `id` (orderId Etherfuse) · `quoteId` 🔑 · `status` · `stellarTxHash` · `stellarClaimableBalanceId` (PLINA-MOD-007) · `claimTxHash` · `paymentInstructionsJson` · `settledAt` |
| `OffRampOrder` | Reverso TESOURO→BRL (burn XDR assinado pelo Privy) | `id` (orderId Etherfuse) · `quoteId` 🔑 · `status` · `burnXdr` · `burnStellarTxHash` · `fiatInstructionsJson` · `settledAt` |

### Modelos — Funil Vendedor

| Modelo | Propósito | Campos-chave |
| --- | --- | --- |
| `LeadVendedor` | Lead capturado em `/vender` (UTMs rastreados) | `id` · `email` 🔑 · `nome` · `telefone` · `cpf` · `status` (`LeadVendedorStatus`) · `motivoPerda` · `pessoaId`→Pessoa · `utmSource`/`utmMedium`/`utmCampaign` |
| `Oferta` | Oferta firme (versionada) | `id` · `leadVendedorId` · `tipoBem` · `valorCarta` · `desagioAquisicao` · `valorLiquidoVendedor` · `validade` · `status` (`OfertaStatus`) · `versao` |
| `Cessao` | Cessão de direito creditório (hash on-chain, §6.1) | `id` · `ofertaId` 🔑 · `docusignEnvelopeId` · `hashDocumento` (SHA-256 do PDF assinado) · `onChainTxHash` · `status` (`CessaoStatus`) · `caminhoCessao` · `taxaAnuenciaBps` · `administradoraApiId` |
| `Pagamento` | Pagamento ao cedente | `id` · `cessaoId` 🔑 · `metodo` (`PagamentoMetodo`) · `valor` · `onChainTxHash` · `comprovanteUrl` · `status` (`PagamentoStatus`) |

### Modelos — Funil Comprador

| Modelo | Propósito | Campos-chave |
| --- | --- | --- |
| `LeadComprador` | Lead capturado em `/comprar` (PF/PJ) | `id` · `email` 🔑 · `documento` (CPF/CNPJ) · `tipo` (`LeadCompradorTipo`) · `intencaoBem` · `faixaCapital` · `prazoDecisao` · `status` (`LeadCompradorStatus`) · `pessoaId`→Pessoa · `utm*` |
| `Reserva` | Reserva de cota pelo comprador (72h, PRD §6.8) | `id` · `cotaId` · `leadCompradorId` · `expiraEm` · `sinalSimulado` · `onChainTxHash` · `status` (`ReservaStatus`) |
| `CessaoComprador` | Cessão ao comprador (ancorada na Reserva) | `id` · `reservaId` 🔑 · `pessoaId` · `docusignEnvelopeId` · `hashDocumento` (SHA-256) · `onChainTxHash` · `status` |
| `RealizacaoCaminho` | Realização da cota (POC: caminho A) | `id` · `cotaId` 🔑 · `caminho` (`CaminhoRealizacao`) · `leadCompradorId` · `valorRealizado` · `custoAquisicao` · `spread` · `onChainTxHash` |

### Modelos — Auditoria, Admin & Extensões PRD (M3–M7)

| Modelo | Propósito | Campos-chave |
| --- | --- | --- |
| `EventoAudit` | Trilha append-only de mudanças de estado | `id` · `acao` (`AcaoAudit`) · `operador` · `motivoClawback` · `fundamentoUrl` · `payloadJson` · `payloadHash` (SHA-256 = memo Stellar) · `stellarTxHash` · `privyId` · FKs polimórficas |
| `AdminSession` | Sessão do painel admin (POC) | `id` · `sessionId` 🔑 (cookie httpOnly) · `criadoEm` · `expiraEm` · `revogadoEm` |
| `WalletProvisioning` | Lock de idempotência do `ensureStellarWallet` (F-16) | `privyId` 🔑 · `publicKey` |
| `LiquidacaoSubmit` | Idempotência do `/liquidar/submit` (C-04) | `id` · `xdrHash` 🔑 (`sha256(xdr)`) · `investidorId` · `txHash` |
| `HoldingPLINARF` | Espelho de saldo por classe (reconciliado vs Horizon) | `id` · `investidorId` · `classe` (`ClassePLINARF`, combo 🔑) · `saldo` · `emissaoTxHash` |
| `NavSnapshot` | Publicação diária de NAV (18:00 BRT, M5) | `id` · `data` 🔑 · `navTotal` · `navPorToken` · `tokensVivos` · `classeSeniorNav` · `classeSubordinadaNav` · `composicaoJson` · `publishedTxHash` |
| `JanelaLiquidez` | Janela periódica de liquidez (resgate) | `id` · `abreEm` · `fechaEm` · `capTotal` (nullable) · `consumido` · `status` |
| `PrestadorRegulado` | Registro de prestadores nominais (M6) | `id` · `papel` · `nome` · `cnpj` · `numeroRegistroCVM` · `urlVerificacao` · `ativoDesde` · `desativadoEm` |

> 🔑 = `@id`/`@unique`/restrição de unicidade. Campos completos e relações no
> `prisma/schema.prisma`.

---

## 10. Referência de API

Route handlers em `app/api/`. A adoção do envelope padrão é incremental (`lib/api/*`);
handlers legados ainda retornam `NextResponse.json` cru.

### Envelope e erros

Definido em `lib/api/response.ts` + `lib/api/errors.ts` + wrapper `lib/api/with-api.ts`:

- **Sucesso:** `{ data: T, error: null }` (HTTP 200/201).
- **Falha:** `{ data: null, error: { code, message, requestId } }`.
- Todo response carrega o header **`x-request-id`** (UUID) para correlação com logs.
- O cliente discrimina por `error.code` (machine-readable), nunca pelo texto.

| Código | HTTP | Significado |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Token ausente ou inválido |
| `FORBIDDEN` | 403 | Autenticado, sem permissão |
| `NOT_ONBOARDED` | 403 | Token Privy OK, mas sem `Investidor` no DB |
| `VALIDATION_FAILED` | 400 | Zod rejeitou body/query |
| `NOT_FOUND` | 404 | Recurso inexistente |
| `CONFLICT` | 409 | Estado inválido (ex.: cota já realizada) |
| `STELLAR_SUBMIT_FAILED` | 502 | Horizon retornou erro |
| `ETHERFUSE_ERROR` | 502 | Anchor retornou erro |
| `INTERNAL` | 500 | Erro inesperado (não vaza mensagem original) |

### Mecanismos de autenticação

| Mecanismo | Onde | Como |
| --- | --- | --- |
| **Investidor (Privy)** | `lib/wallet/auth-guard.ts` → `requireInvestidor(req)` | Bearer token Privy → resolve `Investidor` por `privyId`; retorna `{ privyId, investidorId, publicKey, email, etherfuseCustomerId }` |
| **Pessoa (Privy, multi-papel)** | `lib/wallet/pessoa-auth.ts` → `requirePessoa(req)` | Bearer token Privy → resolve `Pessoa` (cedente/comprador/investidor) |
| **Admin (cookie + CSRF)** | `lib/auth/admin.ts` + `lib/auth/admin-csrf.ts` | Cookie httpOnly `plina_admin` + header `x-plina-admin: 1` + validação de `Origin`/`Referer` |
| **Público** | `scripts/lint/require-auth-guard.mjs` → `PUBLIC_ROUTES` | Sem auth (rate-limited; alguns com BotID/LGPD) |

**São exatamente cinco rotas públicas**, e a lista autoritativa é a allowlist do lint de
pré-build — não esta tabela. Se divergirem, o lint manda e este arquivo está errado:

| Rota | Justificativa registrada na allowlist |
|---|---|
| `investidor/onboard` | signup — valida token Privy no handler |
| `comprar/lead` | captação de lead — BotID + rate-limit |
| `vender/simular` | simulador read-only, sem persistência |
| `pool/summary` | agregados públicos read-only |
| `comprovante/[cessaoId]` | recibo — `cessaoId` é bearer token na URL |

> **Correção de 2026-08-18.** Este documento afirmava que `/api/comprar/reservar` e
> `/api/vender/aceitar-oferta` eram públicas. **As duas são autenticadas** com `withPessoaAuth`,
> e `aceitar-oferta` ainda exige `kycAprovado`. O erro estava aqui, não no código — mas
> documentação de segurança errada é pior que ausente: leva um auditor a reportar buraco que não
> existe, e um desenvolvedor a "consertar" o que está certo.

### Investidor — onboarding e conta

| Rota | Método | Auth | Request (Zod) | Response |
| --- | --- | --- | --- | --- |
| `/api/investidor/onboard` | POST | Privy (sem investidor) | `{ nome?, cpf?, jurisdicao? }` | investidor + `trustlinesReady` (idempotente; rate-limited) |
| `/api/investidor/quote` | POST | Investidor | `{ amountBrl?, amountTesouro?, direction?, classe?, customerId, stellarAddress }` | `{ quoteId, fromAmount, toAmount, exchangeRate, fee, expiresAt }` |
| `/api/investidor/events` | GET | Investidor | — | `{ investidorId, events[] }` (últimos 50, sem chaves internas) |
| `/api/investidor/entidade` | POST | Investidor | `{ track, razaoSocial, cnpj?, jurisdicao?, entityType, estimatedTicket?, currency? }` | `{ persisted }` |
| `/api/investidor/suitability` | POST | Investidor | `{ perfil, experiencia, aumBrl, cienteRisco }` | `{ tipo, persisted }` (CVM 30) |
| `/api/investidor/bank-account/register` | POST | Investidor | `{ pixKey, pixKeyType, cpf, firstName, lastName }` | `{ bankAccountId, status, idempotent? }` |

### Investidor — buy (emissão pós on-ramp)

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/investidor/buy/trust-tesouro/build` · `/submit` (alvo: `trust-bridge` — o ativo-ponte é configuração, não constante) | POST | Investidor | `{ pubkey }` / `{ xdr, investorPubkey, signatureHex }` | XDR `changeTrust` TESOURO / `{ trustlineTxHash }` (sem autorização do issuer) |
| `/api/investidor/buy/trust-plinarf/build` · `/submit` | POST | Investidor | `{ pubkey, assetCode? }` / `{ xdr, investorPubkey, signatureHex, assetCode? }` | XDR / `{ trustlineTxHash, authorizeTxHash }` (issuer autoriza server-side; PLINARF/PLINARFB) |
| `/api/investidor/buy/onramp/create` | POST | Investidor | `{ quoteId }` | `{ orderId, status, paymentInstructions, mock }` |
| `/api/investidor/buy/onramp/status` | GET | Investidor | `?orderId` | `{ status, stellarTxHash, stellarClaimableBalanceId, claimTxHash, ... }` (poll Etherfuse) |
| `/api/investidor/buy/onramp/sandbox-pay` | POST | Investidor | `{ orderId }` | simula PIX (sandbox; 403 em prod) |
| `/api/investidor/buy/claim/build` · `/submit` | POST | Investidor | `{ orderId }` / `{ orderId, xdr, signatureHex }` | XDR `claimClaimableBalance` / `{ claimTxHash }` (PLINA-MOD-007) |
| `/api/investidor/buy/swap/build` | POST | Investidor | `{ quoteId, investorPubkey, investidorId? }` | `{ xdr, hashHex, distributorSigBase64, distributorPubkey, mock }` (envelope atômico 2 pernas) |
| `/api/investidor/buy/swap/submit` | POST | Investidor | `{ quoteId, investorPubkey, signatureHex, xdr, distributorSigBase64, distributorPubkey }` | `{ swapTxHash, idempotent? }` (valida XDR vs quote; consome quote) |
| `/api/investidor/buy/offramp/create` · `/status` · `/signing-tx` · `/submit` | POST/GET | Investidor | `{ quoteId }` / `?orderId` / `{ orderId }` / `{ orderId, xdr, signatureHex }` | ordem off-ramp + burn XDR + `{ burnStellarTxHash }` |

### Investidor — liquidar (venda de PLINARF de volta)

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/investidor/liquidar/quote` | POST | Investidor | `{ amountPlinarf }` | valor BRL ao NAV atual (rate-limited; sem persistência) |
| `/api/investidor/liquidar/build` | POST | Investidor | `{ pubkey, amount }` | `{ xdr, hashHex }` (payment investidor→distributor) |
| `/api/investidor/liquidar/submit` | POST | Investidor | `{ xdr, pubkey, signatureHex, amount? }` | `{ txHash }` (amount no XDR é autoritativo) |

### Conta (multi-papel)

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/conta/me` | GET | Pessoa | — | `{ authenticated, pessoaId, nome, email, kycAprovado, kycStatus, papeis }` |
| `/api/conta/kyc` | POST | Pessoa | `{ nome?, cpf?, papel, bankAccount? }` | `{ pessoaId, kycAprovado, kycStatus, papeis, etherfuseBankAccountId? }` |

### Comprar (funil comprador)

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/comprar/cotas` | GET | Pessoa | — | `{ cotas[] }` (DISPONIVEL/RESERVADA; administradora não exposta) |
| `/api/comprar/cota/[id]/diligencia` | GET | Pessoa | — | `{ cota, eventos[] }` |
| `/api/comprar/lead` | POST | Público | `{ nome, email, telefone?, documento?, tipo?, intencaoBem?, faixaCapital?, prazoDecisao?, consentimentoLgpd, origem?, utm* }` | `{ leadId }` (BotID + rate-limit + LGPD) |
| `/api/comprar/reserva` | POST | Pessoa | `{ cotaId, sinalSimulado? }` | `{ reservaId, expiraEm, txHash, payloadHash }` |
| `/api/comprar/reservar` | POST | **Pessoa** | `{ cotaId, leadCompradorId, sinalSimulado? }` | duplicata quase idêntica de `/reserva`; o alvo remove esta (`ARQUITETURA-ALVO.md` §4.6) |
| `/api/comprar/kyc` | POST | Pessoa | `{ nome?, cpf? }` | KYC papel COMPRADOR (emite `KYC_COMPRADOR`) |
| `/api/comprar/cessao` | POST | Pessoa | `{ reservaId }` | `{ cessaoCompradorId, hashDocumento, txHash }` (idempotente por reservaId) |
| `/api/comprar/confirmar` | POST | Pessoa | `{ reservaId }` | `{ status, realizacaoId?, spread?, ... }` (com flag `BUYER_SELF_REALIZACAO` executa caminho A) |

### Vender (funil vendedor)

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/vender/simular` | POST | Público | `{ tipoBem, administradora?, valorCarta, prazoRestanteMeses? }` | `{ faixaBaixa, faixaAlta }` (indicativo; sem persistência) |
| `/api/vender/lead` | POST | Pessoa (KYC aprovado) | `{ telefone?, consentimentoLgpd, origem?, utm* }` | `{ leadId }` (nome/email vêm da Pessoa) |
| `/api/vender/aceitar-oferta` | POST | **Pessoa + KYC aprovado** | `{ ofertaId }` | aceita oferta firme (`Oferta`→ACEITA; audit on-chain) |

### Admin · Pool · Lab · Comprovante

| Rota | Método | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/admin/originacao` | POST | Admin | `{ action, ...payload }` | multiplexador: `gerar-oferta`, `registrar-cessao`, `executar-pix-simulado`, `incorporar-cota` |
| `/api/admin/realizacao` | POST | Admin | `{ action, ...payload }` | multiplexador: `cancelar-reserva`, `executar-caminho-a` |
| `/api/admin/logout` | POST | Admin | — | 303 → `/admin` (limpa cookie) |
| `/api/pool/summary` | GET | Público | — | `{ assetCode, network, navTotal, tokensVivos, navPorToken, caixaRealizado, navPorTipo, navSource, ... }` |
| `/api/lab/ensure-wallet` · `/build-trustline` · `/submit-tx` | POST | Investidor | — / — / `{ xdr, signatureHex }` | utilitários testnet — **404 se `LAB_ENABLED=false`** (sempre off em mainnet) |
| `/api/comprovante/[cessaoId]` | GET | Público | — | stream do PDF (Vercel Blob privado); `cessaoId` é token opaco |

### Padrões transversais

- **Rate-limit** por categoria (ver [§12](#12-observabilidade-e-segurança-operacional)).
- **Idempotência:** `Quote.submitXdrHash`, `LiquidacaoSubmit.xdrHash`, trustline via
  `EventoAudit`, registro de bank account, claim e aceite de oferta.
- **BotID** nos POSTs de lead (`/vender/lead`, `/comprar/lead`).
- **Modo mock/sandbox:** em testnet, on/off-ramp caem em mock quando falta bank account no
  Etherfuse; o campo `mock` na resposta sinaliza o caminho.

---

## 11. Decisões de arquitetura e segurança

- **Quote binding server-side + swap atômico.** Antes, era possível submeter um valor
  arbitrário no `/buy/submit`, ignorando a quote. Hoje a quote é persistida no servidor e o
  valor é derivado de `Quote.toAmount`, com guarda *single-shot*; o swap virou um envelope
  atômico de 2 pernas. ([`docs/2026-05-18-quote-binding-and-atomic-swap.md`](./2026-05-18-quote-binding-and-atomic-swap.md))
- **Fail-closed em mainnet.** A porta `StellarSigner` recusa operar na rede `PUBLIC` sem
  custódia configurada — segredos de chave nunca assinam em produção.
  ([`docs/M0-foundation-fase1.md`](./M0-foundation-fase1.md))
  ⚠️ **Como está codificado hoje**, `custodyConfigured()` (`lib/stellar/signer.ts:56`) verifica
  literalmente `FIREBLOCKS_API_KEY`/`FIREBLOCKS_API_SECRET` — o invariante está preso a **um
  fornecedor**, e por isso bloquearia a guarda própria com multisig escolhida para a fase 01. O
  alvo reenuncia por propriedade: *mainnet recusa assinar se um único segredo de ambiente bastar
  para produzir assinatura válida*. Exceção declarada: o **funder** assina com secret em env
  mesmo em mainnet (`signer.ts:10`).
- **Auth-guard lint no pré-build.** `scripts/lint/require-auth-guard.mjs` roda em `prebuild`
  e barra o build se alguma rota sensível não estiver protegida por guard de auth.
- **Hardening Zod** em ~20 rotas de API (validação de entrada estrita).
- **Rate-limit** com Upstash Redis em produção.
- **BotID** (Vercel) nos formulários de lead (`next.config.ts` via `withBotId()`).
- **PII off-chain (LGPD).** Apenas hash, endereços e timestamps vão para a chain; dados
  pessoais ficam no Postgres.
- **Refator do god-component** de `/investir` (de ~2547 para ~220 linhas), extraindo os
  hooks compostos descritos na [seção 5](#5-fluxos-principais-mapa-no-código).

---

## 12. Observabilidade e segurança operacional

Esta seção detalha o **como** dos pontos que a [§11](#11-decisões-de-arquitetura-e-segurança)
cita como decisão.

### OpenTelemetry (F-M0-3)

- **Backend** (`instrumentation.ts`): no-op em dev/test (custo zero); `OTEL_MODE=console`
  exporta spans via `ConsoleSpanExporter` para stdout (staging); em produção, OTLP via
  `@opentelemetry/sdk-node` (`serviceName=plina`), endpoint configurável.
- **Client** (`instrumentation-client.ts`): registra o desafio **BotID** (Vercel) protegendo
  os POSTs de `/api/vender/lead` e `/api/comprar/lead`; verificação real só em deploy Vercel.
- **Helper** (`lib/observability/tracer.ts`): `withSpan(name, attrs, fn)` executa `fn` dentro
  de um span, marca status OK/ERROR e registra exceções; no-op quando não há provider.

### Rate-limit (C-06)

Limiters compartilhados por categoria (`lib/rate-limit/config.ts`). Em prod/preview usam
**Upstash Redis** (`lib/rate-limit/upstash.ts`, sliding-window, prefixo `plina:rl:*`); em
dev/CI caem para **in-memory** (`lib/rate-limit/in-memory.ts`, token bucket, IP via
`x-forwarded-for`, ~10k chaves LRU).

| Limiter | Prefixo | Limite | Janela | Uso |
| --- | --- | --- | --- | --- |
| `leadLimiter` | `lead` | 5 | 60s | `/vender/lead`, `/comprar/lead` (anti-bot) |
| `publicLimiter` | `public` | 20 | 60s | rotas públicas (`simular`, `summary`, …) |
| `sensitiveAuthLimiter` | `sensitive` | 10 | 60s | rotas autenticadas com efeito colateral caro (Etherfuse) |
| `adminLoginLimiter` | `admin-login` | 5 | 15min | login admin (C-05) |

### CSRF do admin (N-10/N-11)

`lib/auth/admin-csrf.ts`: exige header **`x-plina-admin: 1`** (forms HTML não setam header
custom), cookie `plina_admin` **SameSite=lax**, e valida `Origin` (preferido) ou `Referer`
contra o host. Retorna 403 se header ausente, origem divergente ou malformada. É helper
chamado explicitamente por rota, não middleware.

### Trilha de auditoria on-chain (§6.1 + §9)

`lib/stellar/audit.ts`: cedente/comprador **não têm wallet Stellar** — a Plina assina um
self-payment (0.0000001 XLM) na conta issuer com **`Memo.hash`** carregando o SHA-256 do
payload.

- **Por que memo e não `manageData`:** `manageData` cobra reserva de 0,5 XLM por entrada;
  o memo é gratuito, cabe exatos 32 bytes (SHA-256) e fica público no Stellar Expert.
- **Determinismo:** `stableSerialize()` canonicaliza o JSON com chaves ordenadas → mesmo
  payload sempre gera o mesmo hash (prova reproduzível).
- **Fluxo:** `buildAuditPayload` (prepende `_type`/`_at`/`_ref`) → `sha256OfPayload` →
  `registerOnChainHash` → `{ payloadHash, txHash }` persistido em `EventoAudit`.
- **Resposta da API:** `lib/audit/strip-internal.ts` (`stripInternalKeys`) remove as chaves
  de topo iniciadas por `_` antes de devolver eventos ao cliente (N-17).

### Auth-guard lint (pré-build)

`scripts/lint/require-auth-guard.mjs` roda no `prebuild` e **barra o deploy** se alguma rota
em `app/api/investidor/**` não importar `@/lib/wallet/auth-guard` (allowlist: `onboard`, que
cria o `Investidor` e não pode resolvê-lo via guard; `events`).

---

## 13. Decisões estruturais e trade-offs de stack (por quê)

Esta seção explica **por que** cada peça central foi escolhida — e o que foi descartado.
Fontes: [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md) (§ decisões técnicas e arquitetura) e
[`README.md`](../README.md).

### Blockchain: Stellar (em vez de Ethereum)

- **Por quê:** o token precisa de **controles regulatórios nativos** — `AUTH_REQUIRED`
  (whitelisting por KYC), `AUTH_REVOCABLE` (congelar) e `AUTH_CLAWBACK_ENABLED` (recuperar).
  Na Stellar isso é primitivo do protocolo; em Ethereum exigiria contrato ERC-20 customizado
  (mais superfície de ataque, auditoria de contrato, gás caro).
- **Bônus:** USDC/EURC da Circle nativos, **anchors SEP** regulados em múltiplas jurisdições
  (essencial para o investidor internacional, M4), taxas baixas e finalização rápida.
- **Trade-off:** menos ferramental DeFi/composabilidade que Ethereum — irrelevante para o
  caso de uso (ativo regulado, não DeFi aberto). Lógica programável virá via **Soroban** (M7).

### Banco de dados: Neon Postgres (em vez de outro Postgres/Mongo/etc.)

- **Por quê Postgres relacional:** o domínio é fortemente relacional e transacional (Pessoa →
  Investidor → Cota → Oferta → Cessão → Pagamento), com necessidade de integridade e
  *idempotência* por chaves únicas. NoSQL traria consistência eventual onde não se pode tê-la.
- **Por quê Neon especificamente:** é **Postgres serverless** com **branching automático por
  preview deploy** — cada PR na Vercel ganha um banco isolado, sem subir infraestrutura.
  Casa com o modelo serverless da Vercel (escala a zero, sem servidor ocioso).
- **Detalhe de uso:** duas connection strings — `DATABASE_URL` (pooled, para as functions) e
  `DIRECT_URL` (conexão direta, para migrations). O pooling é necessário porque funções
  serverless abrem muitas conexões curtas.
- **Lembrete arquitetural:** o Postgres é **cache/registro**, não a fonte da verdade de saldos
  (essa é a chain — ver [seção 4](#4-arquitetura)).

### Carteira do investidor: Privy (em vez de exigir carteira própria)

- **Por quê:** o investidor institucional não quer (nem deve) gerenciar seed phrase. O Privy
  cria uma **carteira embarcada** no login por email/Google e assina via **raw-hash** sob
  demanda — a chave fica custodiada, o UX é de "fintech", não de "cripto".
- **Self-custody:** ainda assim o investidor é dono da sua carteira (não é custódia da Plina),
  com *social recovery* previsto para a Fase 2 via smart account Soroban.
- **Contraste deliberado:** **cedente e comprador não têm carteira** — operam off-chain (PIX +
  DocuSign + carta de crédito na administradora), porque não precisam tocar no token.

### Custódia operacional: multisig, com fornecedor em aberto

- **O que não se reabre:** em mainnet, as chaves de **issuer/distributor** controlam o ativo do
  veículo e não podem viver como `STELLAR_*_SECRET` em env — modelo aceitável só no POC.
- **O que foi reaberto em 2026-08-18:** *qual* custódia. São **três** opções — guarda própria com
  multisig nativo Stellar, Fireblocks, ou custodiante equivalente. A **fase 01 assume guarda
  própria**: não há terceiro detendo token e o auditor que poderia exigir custodiante qualificado
  só existe na fase 02, então pagar o piso do fornecedor mais caro da categoria agora é comprar
  sinal de compliance sem plateia.
- **Por que a escolha não prende:** signatário Stellar rotaciona por `setOptions` — acrescenta-se
  a chave do custodiante, remove-se a antiga, ajusta-se o threshold. Sem reemissão de ativo, sem
  migração de holder.
- **Como está preparado:** a porta `StellarSigner` (`lib/stellar/signer.ts`) existe com guarda
  *fail-closed*, mas hoje ela testa credencial de um fornecedor específico (§11) e precisa passar
  a testar a topologia de assinatura.
- Detalhe e trade-offs: [`ARQUITETURA-ALVO.md` §14.3 e §10.5](./ARQUITETURA-ALVO.md#14-decisões-pendentes),
  [`ESTUDO-CUSTODIA.md`](./ESTUDO-CUSTODIA.md), [`DECISOES-CEO.md` §2](./DECISOES-CEO.md).

### On/Off-ramp: Etherfuse (em vez de PSP próprio ou outro anchor)

- **Por quê:** converter BRL↔cripto exige uma entidade **regulada**. O Etherfuse é uma
  **anchor LATAM regulada**, com trilho **PIX** e o ativo-ponte **TESOURO**. Decisão de manter o
  fornecedor reconfirmada em 2026-08-18.
- ⚠️ **Correção de 2026-08-18 — a integração não é SEP.** Este documento afirmava compatibilidade
  com SEP-12/24/38. O que o código consome é a **API proprietária** do fornecedor: organização
  `personal`/`business`, launch `/idv` e `/kyb`, webhooks `kyc_updated`. Nenhum desses conceitos
  tem equivalente SEP. O SEP-1 (`.well-known/stellar.toml`) é o único que a Plina de fato
  publica, e é outro assunto.
- ⚠️ **E o rail BRL ainda não é GA** — Brasil aparece como *Upcoming* na documentação do
  fornecedor; o único mercado live é o México. Data e preço precisam de confirmação por escrito.
- **Estratégia multi-anchor, corrigida:** como o contrato da porta foi derivado de um único
  fornecedor proprietário, os anchors regionais (MoneyGram, Settle), que falam SEP, **não vão
  encaixar como adaptador** — vão forçar re-derivar o contrato em M4. O alvo assume isso como
  plano, não como acidente ([`ARQUITETURA-ALVO.md` §2.3 e §7.1](./ARQUITETURA-ALVO.md#23-anchor--etherfuse)).
- **Por que vendorizar o SDK:** o SDK foi copiado para `lib/anchors/etherfuse/` para aplicar
  patches específicos da Plina (os 7 `PLINA-MOD-*`) sem depender de um fork upstream.

### Plataforma e framework: Vercel + Next.js 16 (App Router)

- **Por quê Next.js App Router:** permite **SSR** nas páginas que precisam ser indexáveis e
  institucionais (`/`, `/pool`, `/cotas/[id]`) e **CSR** nos fluxos interativos (`/investir`,
  `/vender`, `/comprar`) — o mesmo framework cobre marketing e aplicação.
- **Por quê Vercel (Fluid Compute, Node 24):** funções com timeout de até 300s e reuso de
  instância; jobs longos (NAV diário, polling do Etherfuse) usam **Cron Jobs / Workflow**.
  Integra nativamente Neon (branching), Blob, Edge Config e BotID — menos infraestrutura para
  manter.
- **Vercel Blob (privado):** guarda PDFs sensíveis (prospecto, contratos assinados,
  comprovantes) com acesso controlado.
- **Vercel Edge Config:** *feature flags* (`MAINNET_ENABLED`, `INTL_INVESTOR_FLOW`, etc.) lidas
  na borda, permitindo ligar/desligar trilhas sem deploy.

### ORM: Prisma

- **Por quê:** schema tipado em um só lugar (`prisma/schema.prisma`), migrations versionadas e
  client type-safe em TypeScript — reduz erro de query e mantém o modelo de dados como
  documentação viva.

### Estilo: Tailwind v4 *config-less*

- **Por quê:** os tokens da marca vivem em um único lugar (`@theme` em `app/globals.css`), sem
  arquivo de config separado. Garante consistência com o design system "Regulated Terminal" e
  evita divergência entre config e CSS.

### Rate-limit: Upstash Redis (em vez de estado em memória)

- **Por quê:** em ambiente serverless **não há memória compartilhada entre instâncias** — um
  contador em RAM não limita nada. O Upstash é um Redis serverless acessível por todas as
  funções, viabilizando rate-limit real nas rotas públicas (P0).

### Observabilidade: OpenTelemetry

- **Por quê:** padrão **aberto e portável** (traces/spans) — instrumenta as chamadas a Stellar
  e Etherfuse sem amarrar a um fornecedor específico; pode exportar para Datadog ou equivalente.

### Resumo dos trade-offs

| Escolha | Principal motivo | Principal trade-off aceito |
| --- | --- | --- |
| Stellar | Flags regulatórias nativas (clawback/auth) | Menos ecossistema DeFi |
| Neon | Postgres serverless + branching por PR | Acoplamento ao modelo serverless |
| Privy | UX sem seed phrase, self-custody | Dependência de provedor de wallet |
| Multisig nativo Stellar (fase 01) | Sem fornecedor, sem piso mensal, rotação por `setOptions` | Ônus de compliance e de processo interno fica conosco |
| Custodiante institucional (fase 02, se o auditor exigir) | MPC/policy engine, menos explicação a um auditor | Item mais caro da lista — decidir contra exigência real, não suposta |
| Etherfuse | Anchor regulado com PIX | Dependência de terceiro; API proprietária (não SEP) e rail BRL ainda não GA |
| Vercel + Next 16 | SSR+CSR no mesmo stack, infra gerenciada | *Lock-in* parcial de plataforma |
| Tailwind config-less | Fonte única de tokens da marca | Convenção menos familiar |

---

## 14. Deploy, configuração e runbooks

### Variáveis de ambiente

Template sem segredos em `.env.example`. Por categoria:

| Categoria | Variáveis |
| --- | --- |
| SMTP / e-mail | `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASS` · `LEAD_EMAIL_TO` · `INCIDENT_SMTP_USER` · `INCIDENT_SMTP_PASS` · `INCIDENT_EMAIL_TO` · `APP_BASE_URL` |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` (PDFs privados; no-op se vazio) |
| Stellar | `STELLAR_NETWORK` · `STELLAR_HORIZON_URL` · `ASSET_CODE` (`PLINARF`) · `ASSET_CODE_SUBORDINADA` (`PLINARFB`) · `STELLAR_ISSUER_SECRET` · `STELLAR_DISTRIBUTOR_SECRET` · `ISSUER_BALANCE_FLOOR` · `DISTRIBUTOR_BALANCE_FLOOR` |
| Custódia (mainnet) | `FIREBLOCKS_API_KEY` · `FIREBLOCKS_API_SECRET` (vazio em testnet) |
| Observabilidade | `OTEL_MODE` (`console`/produção) |
| Feature flags | `EDGE_CONFIG` · `MAINNET_ENABLED` · `INTL_INVESTOR_FLOW` · `SOROBAN_WATERFALL` · `M3_INSTITUTIONAL_GATING` · `CUSTODY_PROVIDERS` · `BUYER_SELF_REALIZACAO` · `LAB_ENABLED` |
| Banco (Neon) | `DATABASE_URL` (pooled) · `DIRECT_URL` (direto, migrations) |
| Admin POC | `ADMIN_PASSWORD` |
| Privy | `PRIVY_APP_ID` · `PRIVY_APP_SECRET` · `NEXT_PUBLIC_PRIVY_APP_ID` · `PRIVY_VERIFY_STUB` (CI) |
| Rate-limit | `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` (opcionais; fallback in-memory) |
| Etherfuse | `ETHERFUSE_ENV` · `ETHERFUSE_API_KEY` · `ETHERFUSE_BASE_URL` |

### Feature flags

Definidas em `lib/env/flags.ts` (`FlagName`). Fonte canônica em prod: **Vercel Edge Config**;
fallback `process.env` (dev/test). `getFlag(name)` é async (tenta Edge Config); `getFlagSync`
usa só env (middleware/edge). Consumidores em `lib/env/feature-gates.ts`.

| Flag | Controla | Default | Consumidor |
| --- | --- | --- | --- |
| `MAINNET_ENABLED` | cutover canary M9 (gate de rotas mainnet) | `false` | `mainnetCutoverGuard()` → 503 se mainnet + flag off |
| `M3_INSTITUTIONAL_GATING` | suitability CVM 30 + ticket mínimo em `/quote` | `false` | `isInstitutionalGatingEnabled()` |
| `INTL_INVESTOR_FLOW` | onboarding de jurisdição ≠ BR (M4) | `false` | `isIntlInvestorFlowEnabled()` |
| `CUSTODY_PROVIDERS` | custódia institucional (Fireblocks/BitGo/Copper, M4) | `false` | `isCustodyProvidersEnabled()` |
| `SOROBAN_WATERFALL` | fonte de NAV/waterfall on-chain (M7) | `false` | `isSorobanWaterfallEnabled()` |
| `BUYER_SELF_REALIZACAO` | `/comprar` dispara `executarCaminhoA` self-service | `false` | lido direto via `getFlag` na rota `/comprar/confirmar` |
| `LAB_ENABLED` | rotas `/api/lab/*` (só testnet) | `false` | `isLabEnabled()` (`lib/env/lab.ts`) — sempre 404 em mainnet |

### Migrations (Prisma + Neon)

`DATABASE_URL` é pooled (pgbouncer, runtime); `DIRECT_URL` é conexão direta usada só pelo
`prisma migrate` (o pooler é incompatível com DDL). Scripts: `prisma:generate`,
`prisma:migrate` (dev, interativo), `prisma:deploy` (CI/prod, aplica todas), `prisma:seed`,
`prisma:studio`.

### Pipeline de deploy (Vercel)

1. `prebuild` → `pnpm lint:auth-guard` (barra se houver regressão de auth-guard).
2. `next build`.
3. `next start` (runtime, Fluid Compute / Node 24).
4. **Rolling Releases** para o cutover de mainnet (10% → 50% → 100%); flags vivem no Edge
   Config, permitindo ligar/desligar trilhas sem novo deploy.
5. **BotID** (`next.config.ts` via `withBotId()`) instala os rewrites de challenge.

### Runbooks operacionais (`docs/runbooks/`)

| Runbook | Quando | Resumo |
| --- | --- | --- |
| [`mainnet-cutover.md`](./runbooks/mainnet-cutover.md) | Checklist 100% (regulatório + técnico + ops assinados) | Deploy com `MAINNET_ENABLED=false` → toggle canary 10/50/100% com janelas de 48h → carta CVM → freeze de 2 semanas. Rollback ≤5min via flag + rollback Vercel |
| [`pause-emissao.md`](./runbooks/pause-emissao.md) | Etherfuse/Fireblocks/PSP fora, manutenção ou preparo de clawback | `MAINNET_ENABLED=false` (≈30s de propagação) → revalida cache → banner → pausa crons. Rollback após smoke test |
| [`rotate-fireblocks.md`](./runbooks/rotate-fireblocks.md) | Rotação trimestral, suspeita de comprometimento ou saída de pessoa | Pausa emissão → novo vault → `setOptions` adiciona nova chave (threshold N+1) → remove antiga após 2 ledgers → deploy + smoke |
| [`clawback.md`](./runbooks/clawback.md) | Uma das 4 hipóteses (judicial, sanção, fraude, erro op.) | Documentar + dupla aprovação (jurídico + CTO) → `/api/admin/clawback` → `EventoAudit.CLAWBACK_EXECUTADO` com hash do documento → notificar investidor. Irreversível on-chain |
| [`incident.md`](./runbooks/incident.md) | Qualquer incidente | Severidades SEV1 (fundos/PII/mainnet down) · SEV2 (degradação) · SEV3 (não-crítico); triagem 15min → conter → diagnosticar → mitigar → resolver → comunicar |

### Roadmap M0–M9 (mapa flag/modelo → fase)

> **O faseamento M0–M9 é ortogonal ao faseamento de negócio (01/02/03).** Desde 2026-08-18, o
> cutover de mainnet é a **fase 01** e não depende de M3 nem de M6 — que passaram a ser fase 02
> junto com o FIDC. O mapa abaixo continua válido como "onde cada coisa vive no código"; para
> **o que bloqueia mainnet**, a lista re-etiquetada por fase é a
> [`ARQUITETURA-ALVO.md` §13](./ARQUITETURA-ALVO.md#13-do-estado-atual-ao-alvo).

| Fase | Tema | Âncora no código |
| --- | --- | --- |
| M0 | Fundação/segurança (signer, alarms, OTEL, flags) | `lib/stellar/signer.ts`, `lib/env/*`, [`docs/M0-foundation-fase1.md`](./M0-foundation-fase1.md) |
| M1 | Caminho de cessão (API vs cartório) | enum `CaminhoCessao`, `Cessao.taxaAnuenciaBps` |
| M3 | Gating institucional (suitability + ticket) | `M3_INSTITUTIONAL_GATING`, `Investidor.suitabilityJson`/`ticketMinimoCheck`/`enderecoEntidade` |
| M4 | Investidor internacional + custódia | `INTL_INVESTOR_FLOW`, `CUSTODY_PROVIDERS`, `Investidor.jurisdicao` |
| M5 | Publicação diária de NAV | modelo `NavSnapshot` (18:00 BRT) |
| M6 | Prestadores regulados | modelo `PrestadorRegulado` |
| M7 | Waterfall on-chain (Soroban) | `SOROBAN_WATERFALL`, `NavSnapshot.publishedTxHash` |
| M9 | Cutover de mainnet (kill-switch) | `MAINNET_ENABLED`, `mainnetCutoverGuard()`, `runbooks/mainnet-cutover.md` |

Estado detalhado por fase em [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md).

---

## 15. Design system (resumo)

Doutrina **"The Regulated Terminal"** — terminal financeiro institucional, sóbrio.

- **Cores:** base *deep petrol* (`#132728`); um único sinal *auditable cyan* (`#0EA7C7`)
  ocupando **≤10%** da viewport; superfícies alternadas branco → cinza-documento → petrol.
- **Tipografia:** Chillax (títulos), Satoshi 300 (corpo), Geist 700 (labels/eyebrows),
  Geist Mono (todo número com significado financeiro/regulatório).
- **Regras:** sem gradientes, sem sombras, separadores em *hairline* de 1px.
- **Tokens** definidos em `app/globals.css` (bloco `@theme` do Tailwind v4).

Fonte completa: [`DESIGN.md`](../DESIGN.md) e [`docs/Plina_Lovable_Design_System.md`](./Plina_Lovable_Design_System.md).

---

## 16. Como rodar e scripts

```bash
pnpm install
pnpm prisma:generate        # gera o client Prisma
pnpm prisma:migrate         # aplica migrations (usa .env.local)
pnpm prisma:seed            # dados de teste
pnpm dev                    # next dev
```

| Script | Função |
| --- | --- |
| `pnpm dev` / `build` / `start` | Ciclo Next.js (`prebuild` roda o auth-guard lint) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `test:watch` | Vitest |
| `pnpm test:e2e` / `test:e2e:stub` | Playwright (stub usa `E2E_STUB=1`) |
| `pnpm smoke:stellar` / `smoke:etherfuse` / `smoke:audit` | Smoke tests de integração |
| `pnpm prisma:*` | `generate`, `migrate`, `deploy`, `seed`, `studio` |

**Variáveis de ambiente** (template em `.env.example`, sem segredos), por categoria:
SMTP/lead, Vercel Blob, Stellar (`STELLAR_NETWORK`, `STELLAR_HORIZON_URL`, `ASSET_CODE`,
secrets de issuer/distributor), Fireblocks, OTEL, feature flags (`MAINNET_ENABLED`,
`INTL_INVESTOR_FLOW`, `SOROBAN_WATERFALL`, `M3_INSTITUTIONAL_GATING`), Postgres
(`DATABASE_URL`/`DIRECT_URL`), `ADMIN_PASSWORD`, Privy, Upstash e Etherfuse.

---

## 17. Testes

- **Vitest** (`vitest.config.ts`) — unitários/integração em ambiente jsdom; hooks do
  `/investir` têm cobertura em `app/investir/_hooks/__tests__/`.
- **Playwright** (`playwright.config.ts`) — e2e com 2 projetos (chromium + `e2e-stub` para
  Privy), execução sequencial (`workers=1`) para evitar corrida no Neon.
- **Smoke scripts** (`scripts/smoke-*.ts`) — exercitam Stellar, Etherfuse e a trilha de
  auditoria fora do navegador.

---

## 18. Glossário

Termos técnicos e de domínio usados ao longo do projeto. Agrupados por tema.

### Blockchain / Stellar

- **Stellar** — rede blockchain pública voltada a pagamentos e emissão de ativos, com
  taxas baixas e finalização rápida (~5s). É a rede onde a Plina emite o token PLINA-RF.
- **Horizon** — a API HTTP de leitura/escrita da Stellar. É por ela que a aplicação
  consulta saldos e submete transações. Para a Plina, o Horizon é a **fonte da verdade**
  de saldos (o Postgres é só cache).
- **Soroban** — a camada de contratos inteligentes da Stellar. Citado no roadmap (M7)
  para o *waterfall* on-chain de resgate; ainda não implementado.
- **XDR** (*External Data Representation*) — o formato binário em que as transações Stellar
  são serializadas. O backend monta o XDR de uma operação e o frontend assina o seu hash.
- **Trustline** — uma "linha de confiança": antes de receber um ativo emitido por terceiros
  (como PLINARF), a carteira precisa abrir explicitamente uma trustline para aquele ativo.
  Como o emissor exige `AUTH_REQUIRED`, a trustline ainda precisa ser **autorizada** pelo
  emissor (gate de KYC) antes de poder receber o token.
- **Issuer (emissor)** — a conta Stellar que emite (cria) o ativo PLINARF/PLINARFB. Controla
  as flags regulatórias do token.
- **Distributor (distribuidor)** — conta operacional que recebe a emissão do issuer e
  distribui o token aos investidores qualificados (ex.: na perna de retorno do swap).
- **Memo** — um campo curto de metadados anexável a uma transação Stellar. Pode ser texto,
  número ou **hash**. A Plina usa **`memo.hash`** (o SHA-256 de um payload JSON) para gravar
  uma trilha de auditoria imutável on-chain: o hash prova *o quê* aconteceu sem expor os
  dados (que ficam off-chain, por LGPD).
- **Claimable Balance** — um "saldo reclamável": um pagamento que fica retido na rede até
  que o destinatário o **reivindique** (claim) explicitamente. O Etherfuse entrega o TESOURO
  por esse modelo; daí a etapa `claiming` no fluxo de investir.
- **Atomic swap (swap atômico)** — troca de dois ativos dentro de **uma única transação**:
  ou as duas pernas acontecem, ou nenhuma. Na Plina: investidor envia TESOURO ao distributor
  e o distributor envia PLINARF ao investidor, sem risco de uma perna falhar isolada.
- **AUTH_REQUIRED / AUTH_REVOCABLE / AUTH_CLAWBACK_ENABLED** — *flags* de controle que o
  emissor ativa no ativo:
  - `AUTH_REQUIRED`: ninguém recebe o token sem autorização do emissor (whitelisting por KYC).
  - `AUTH_REVOCABLE`: o emissor pode revogar uma autorização concedida (congelar).
  - `AUTH_CLAWBACK_ENABLED`: o emissor pode **recuperar** (clawback) tokens de uma carteira.
- **Clawback** — recuperação forçada de tokens já distribuídos, executável pelo emissor.
  Existe por exigência regulatória; só pode ser acionado sob 4 hipóteses formais (decisão
  judicial, sanção regulatória, fraude documental, erro operacional). Política em
  `/politica-clawback`.
- **Ed25519 / raw-hash signing** — Ed25519 é o algoritmo de assinatura das chaves Stellar.
  *Raw-hash signing* é assinar diretamente o hash de uma transação (em vez de usar uma chave
  privada exportada). O Privy assina o hash sob demanda, mantendo a chave custodiada.
- **NAV** (*Net Asset Value*) — o valor patrimonial líquido do fundo por cota; usado para
  precificar o token e exibido em `/pool`.
- **Stellar Expert** — explorador de blocos público da Stellar; usado para auditar
  transações da Plina (links no `receipt` e no `/pool`).
- **SEP-1/12/24/38** (*Stellar Ecosystem Proposals*) — padrões da Stellar para
  descoberta (`stellar.toml`), KYC, depósito/saque e cotação via anchors.

### Custódia, anchors e pagamentos

- **Fireblocks** — plataforma institucional de **custódia** de chaves e ativos digitais (usa
  MPC/enclaves seguros em vez de uma chave privada em arquivo). Na Plina é **uma das três
  opções** para issuer/distributor em mainnet, ao lado de custodiante equivalente e de guarda
  própria com multisig nativo Stellar; a fase 01 assume guarda própria e a escolha é de fase 02.
  O que vale em qualquer das três é o princípio *fail-closed*: em produção nenhuma transação é
  assinada por um segredo único em variável de ambiente (ver
  [seção 11](#11-decisões-de-arquitetura-e-segurança)).
- **Multisig nativo Stellar** — a conta exige assinatura de mais de uma chave para operar
  (`setOptions` define signatários e *threshold*). É o que sustenta a guarda própria, e é o que
  permite trocar de custodiante depois sem reemitir token: acrescenta-se a chave nova, remove-se
  a antiga.
- **Anchor** — na terminologia Stellar, uma entidade regulada que faz a ponte entre o mundo
  fiat e a blockchain (recebe BRL e entrega cripto, e vice-versa). Na Plina, "Anchor" também
  é o nome da **porta** (interface) em `lib/anchors/types.ts`.
- **Etherfuse** — o anchor usado pela Plina: converte **BRL ⇄ TESOURO** via **PIX**. Roda em
  *sandbox* na testnet e real em produção.
- **TESOURO** — token que representa Tesouro Direto, entregue pelo Etherfuse. Funciona como
  ativo-ponte entre o BRL (via PIX) e o PLINARF.
- **On-ramp / Off-ramp** — *on-ramp* é a entrada de dinheiro fiat para cripto (PIX → TESOURO);
  *off-ramp* é o caminho inverso (TESOURO → BRL), usado na liquidação/saque.
- **PIX** — sistema de pagamentos instantâneos do Banco Central do Brasil; é como o investidor
  paga o on-ramp e como o cedente recebe pela venda da cota.
- **PSP** (*Payment Service Provider*) — provedor de serviços de pagamento; stubs em
  `lib/integrations/psp/`.

### Domínio / regulatório

- **Consórcio** — modalidade brasileira de autofinanciamento coletivo (Lei 11.795/2008) para
  compra de bens; um grupo contribui mensalmente e membros são "contemplados" ao longo do tempo.
- **Cota / Direito creditório** — a participação de um consorciado no grupo. Uma cota
  **contemplada** representa um direito creditório que pode ser cedido (vendido). É o ativo que
  a Plina adquire e tokeniza.
- **Cedente** — quem **cede** (vende) sua cota de consórcio à Plina. É o usuário do fluxo `/vender`.
- **Cessão** — o ato/documento jurídico de transferir a titularidade da cota do cedente para o fundo.
- **Deságio** — o desconto aplicado ao valor de face da cota na compra (a margem da operação).
- **FIDC** (*Fundo de Investimento em Direitos Creditórios*) — veículo regulado que agrupa
  direitos creditórios e emite cotas a investidores. A Plina estrutura os direitos de consórcio
  como um FIDC; o PLINA-RF é a representação on-chain dessas cotas.
- **CVM 175** — a Resolução CVM nº 175 da Comissão de Valores Mobiliários, marco regulatório
  brasileiro de fundos de investimento que ampara a estrutura tokenizada da Plina.
- **CVM** — Comissão de Valores Mobiliários, o regulador do mercado de capitais no Brasil.
- **BACEN** — Banco Central do Brasil. **VASP** (*Virtual Asset Service Provider*) é a
  categoria de prestador de serviços de ativos virtuais sob sua alçada.
- **Classe Sênior / Subordinada** — estrutura de risco do fundo. A **Sênior** (`PLINARF`) tem
  prioridade no recebimento; a **Subordinada** (`PLINARFB`) absorve o primeiro prejuízo
  (*skin-in-the-game*) e serve de colchão para a Sênior.
- **KYC** (*Know Your Customer*) — verificação de identidade do cliente, exigida por
  regulação AML. Modelado pelo enum `KycStatus` e gerido pela `Pessoa`/PessoaProvider.
- **AML / COAF** — *Anti-Money Laundering* (prevenção à lavagem de dinheiro); COAF é o órgão
  brasileiro de inteligência financeira.
- **LGPD** — Lei Geral de Proteção de Dados. Por isso dados pessoais (PII) ficam off-chain;
  on-chain só vão hashes, endereços e timestamps.
- **Suitability** — adequação do produto ao perfil do investidor (dever regulatório, CVM);
  checada em `/api/investidor/suitability`.
- **Roadshow** — processo de apresentação a investidores institucionais (etapa de alta fricção
  do funil `/investir`).

### Plataforma / infraestrutura

- **Privy** — provedor de autenticação e **carteira embarcada**: o usuário entra por
  email/Google e recebe uma carteira Stellar sem gerenciar chave manualmente; assina
  transações via raw-hash. Ver [seção 8](#8-autenticação-e-wallet).
- **Prisma** — ORM (mapeador objeto-relacional) usado para acessar o Postgres em TypeScript;
  schema em `prisma/schema.prisma`.
- **Neon** — Postgres serverless (provedor do banco).
- **Upstash** — Redis serverless; usado para *rate-limiting* das rotas.
- **Vercel Blob / Edge Config / BotID** — serviços da Vercel: **Blob** armazena arquivos
  (PDFs de comprovante); **Edge Config** guarda *feature flags*; **BotID** protege formulários
  contra bots.
- **Feature flag** — chave que liga/desliga um recurso sem novo deploy (ex.: `MAINNET_ENABLED`,
  `INTL_INVESTOR_FLOW`, `SOROBAN_WATERFALL`, `M3_INSTITUTIONAL_GATING`).
- **OpenTelemetry (OTEL)** — padrão de observabilidade (traces/spans) para instrumentar a
  aplicação; configurado em `instrumentation.ts`.
- **Zod** — biblioteca de validação de schema em TypeScript; valida as entradas das rotas de API.
- **CSRF** (*Cross-Site Request Forgery*) — ataque que o token anti-CSRF em
  `lib/auth/admin-csrf.ts` previne no painel admin.
- **Hexagonal-lite (ports & adapters)** — estilo de arquitetura em que a lógica de negócio
  depende de interfaces (portas), não de implementações concretas, facilitando troca de
  provedores. Ver [seção 4](#4-arquitetura).
- **POC / MVP** — *Proof of Concept* (prova de conceito, estágio atual em testnet) e
  *Minimum Viable Product* (produto mínimo viável, alvo em mainnet).
- **Testnet / Mainnet** — rede de testes (sem valor real) versus rede principal de produção.

---

## 19. Índice da documentação existente

| Documento | Conteúdo |
| --- | --- |
| [`README.md`](../README.md) | Visão geral do POC e fluxo de demo |
| [`ONBOARDING.md`](../ONBOARDING.md) | Onboarding de desenvolvedor |
| [`DESIGN.md`](../DESIGN.md) | Design system completo |
| [`PRODUCT.md`](../PRODUCT.md) | Personas, posicionamento e voz de marca |
| [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md) | PRD v1 + estado por fase (M0–M9) |
| [`docs/PRD-readiness.md`](./PRD-readiness.md) | Avaliação de prontidão |
| [`docs/M0-foundation-fase1.md`](./M0-foundation-fase1.md) | Log da Fase 1 (signer, alarms, OTEL, flags) |
| [`docs/2026-05-18-quote-binding-and-atomic-swap.md`](./2026-05-18-quote-binding-and-atomic-swap.md) | Decisão: quote binding + swap atômico |
| [`lib/anchors/README.md`](../lib/anchors/README.md) | Integração Etherfuse + 7 patches |
| [`docs/Plina_Lovable_Design_System.md`](./Plina_Lovable_Design_System.md) | Design system para stack Lovable |
| [`docs/Plina_Finance_Pitch_5min_EN.md`](./Plina_Finance_Pitch_5min_EN.md) | Pitch de 5 minutos |
| `docs/runbooks/` | Runbooks operacionais (clawback, incidente, cutover, etc.) |
| `docs/security-audit-*.md` | Relatórios de auditoria de segurança |

---

*Documento gerado a partir do código e da documentação existentes. Ao alterar fluxos,
rotas ou integrações, atualize a seção correspondente.*
