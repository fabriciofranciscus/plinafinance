# PRD Plina — v1.0 (Mockup Founder-led → Produto)

**Status:** Draft 1 · **Data:** 2026-05-25 · **Owner:** CTO (Thais) · **Sponsor:** CEO (Fabrício)
**Fonte do escopo de UX:** mockup do fundador em https://mockup-plina.lovable.app/
**Fonte do estado atual:** branch `fix/n08-n13-medium-bundle` (commit `c4b59c8`)

---

## 0. Sumário Executivo

A Plina opera um produto único — **PLINA-RF**, token Stellar lastreado em FIDC de cotas de consórcio contempladas — distribuído via quatro superfícies digitais com **fricção assimétrica**:

| Superfície | Público | Fricção | Métrica de sucesso |
|---|---|---|---|
| `/` (Home) | Investidor institucional BR + Internacional | Alta (jargão completo, roadshow) | Roadshow agendado |
| `/investir` | Mesmas personas acima | Alta (KYC institucional, onboarding) | Alocação ≥ ticket mínimo |
| `/vender` | Cotista contemplado (Ricardo) | Mínima (lead → oferta → Pix 48h) | Cessão assinada |
| `/comprar` | Comprador-usuário do bem (Maria, PJ) | Mínima (calculadora → reserva 72h) | Carta de crédito transferida |

O mockup formaliza um produto **multilateral** já parcialmente implementado em testnet (POC funcional para vendedor, comprador e investidor) e define os elementos que ainda **não existem em código**: classes Sênior/Subordinada, FIDC formal, Soroban waterfall, custódia Fireblocks, DocuSign real, KYC institucional internacional, e ficha técnica do PLINA-RF como ativo distribuível.

**Escopo deste PRD:** levar a Plina de POC testnet → MVP Mainnet com cobertura formal CVM 175, alinhando código ao mockup do fundador. Não é um redesign — é um **plano de aterrissagem** que reúsa o que já existe (`/vender`, `/comprar`, `/investir`, `/pool`, audit log on-chain, lint-auth-guard) e fecha os gaps regulatórios e econômicos.

**Não-objetivos:**
- Não atacamos varejo nesta versão (Fase 3 do pitch — 2028).
- Não implementamos liquidez secundária P2P entre holders de PLINA-RF (out-of-scope; janelas periódicas via resgate atômico só).
- Não suportamos clawback discricionário — segue restrito às 4 hipóteses do whitepaper §6.5.

---

## 1. Contexto & Premissas

### 1.1 Regulatório
- **CVM 175** + **Lei 11.795/2008** são o enquadramento. FIDC formal em Fase 1 (depois desta entrega).
- **BACEN VASP**: a Plina é "tokenizadora institucional" (software white-label); a custódia fiat e KYC operam sob anchors registradas (Etherfuse/MoneyGram/Settle).
- **AML/COAF**: KYC obrigatório em ambas as pontas (cedente e investidor). Cedente via DocuSign + e-CPF; investidor via anchor SEP-12.
- **LGPD**: PII off-chain (Brasil); on-chain só hash, endereços e timestamps. Já enforced no schema atual (whitepaper §9).

### 1.2 Decisões técnicas já tomadas (não reabrir)
- **Rede:** Stellar Mainnet (não Ethereum). Razão: clawback + auth flags nativos, USDC/EURC Circle direto, anchors SEP em múltiplas jurisdições. Ver `Plina_Finance_Pitch.md §3`.
- **Asset code on-chain:** `PLINARF` (sem hífen, restrição Stellar). Branding `PLINA-RF`.
- **Custódia do cedente/comprador:** Plina assina em nome do ato. Cedente/comprador **não têm wallet Stellar** — usam Pix off-chain + DocuSign + carta de crédito na administradora.
- **Custódia do investidor:** wallet Privy (self-custody com social recovery em Fase 2 via Soroban smart account).
- **Custódia operacional:** Fireblocks para issuer/distributor (mainnet) — substitui secrets em env do POC.
- **Auth:**
  - Investidor: Privy JWT, `withAuth` em todas as rotas `/api/investidor/**` (lint enforce).
  - Admin: cookie httpOnly + `x-plina-admin` header + CSRF token (POC). Migra para Clerk/Auth.js antes de mainnet.
- **PII off-chain:** auditável (`EventoAudit`), com cross-verify on-chain via memo-hash de tx de auto-pagamento.
- **Idempotência:** `privyId @unique`, `Quote.submitXdrHash @unique`, `WalletProvisioning`, `LiquidacaoSubmit.xdrHash @unique`. Padrão a manter em qualquer novo write path.

### 1.3 O que o mockup do fundador adiciona que ainda não está no código
1. **Diferenciação de classes** Sênior vs. Subordinada na UI e no modelo de dados.
2. **Caminho preferencial vs. fallback de cessão**: integração B2B via API com administradora (SLA contratual) vs. cartório digital + taxa de anuência embutida no deságio.
3. **Trilha internacional** completa (KYC anchor SEP-compliant não-BR, ticket US$ 100k-5M, classe via USDC/EURC).
4. **Ficha técnica do PLINA-RF** como ativo formal (NAV diário, prospecto, eventos on-chain visíveis no Stellar Expert).
5. **Compliance surface** com prestadores nominais (administrador fiduciário, custodiante, auditor Big Four, agência de rating).
6. **Waterfall on-chain via Soroban** (hoje cálculo é em `lib/services/pool.ts` em Postgres).
7. **Validação operacional**: Pix em **mainnet** real (hoje `PIX_SIMULADO` em testnet), DocuSign real (hoje stub), e-CPF real.

---

## 2. Arquitetura Técnica

### 2.1 Topologia

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Vercel (Next.js 16)                            │
│   Fluid Compute · App Router · Server Actions · Routing Middleware     │
└──┬────────────────────┬──────────────────────────┬─────────────────────┘
   │                    │                          │
   ▼                    ▼                          ▼
┌────────┐         ┌──────────┐               ┌──────────┐
│  Neon  │         │  Privy   │               │ Fireblocks│
│ (Pg 16)│         │ (auth+   │               │ (issuer+  │
│ Prisma │         │  wallet) │               │  dist.)   │
└────┬───┘         └────┬─────┘               └────┬─────┘
     │                  │                          │
     │                  ▼                          ▼
     │           ┌──────────┐               ┌──────────────┐
     │           │ Etherfuse│               │   Stellar    │
     │           │ Anchor BR│               │   Mainnet    │
     │           │ SEP-12/24│               │   (Horizon   │
     │           │ SEP-38   │               │   + Soroban) │
     │           └──────────┘               └──────────────┘
     │
     ▼
  ┌──────────┐    ┌──────────┐    ┌──────────────┐
  │ DocuSign │    │ Resend   │    │ Stellar      │
  │ (e-CPF)  │    │ (email)  │    │ Expert (UI)  │
  └──────────┘    └──────────┘    └──────────────┘
```

**Runtime:**
- **Vercel Functions (Fluid Compute, Node 24 LTS)**: APIs `/api/**`. Timeout default 300s; jobs longos (NAV diário, polling Etherfuse) usam **Vercel Workflow DevKit** ou **Cron Jobs**.
- **Vercel Routing Middleware**: rate-limit por IP nas rotas P0 públicas (`/api/vender/lead`, `/api/comprar/lead`) e bot detection via **Vercel BotID** nos forms de lead.
- **Next.js App Router**: SSR para `/`, `/pool`, `/cotas/[id]` (precisam estar indexáveis). CSR para fluxos interativos `/investir`, `/vender`, `/comprar`.

**Persistência:**
- **Neon Postgres 16** (já em uso). Branching automático por preview deploy.
- **Vercel Blob** para PDFs (prospecto, contratos assinados pós-DocuSign, comprovantes). Privado por default.
- **Vercel Edge Config** para feature flags (ex: `MAINNET_ENABLED`, `KYC_PROVIDER`, `INTL_INVESTOR_FLOW`).

**Observability:**
- **Vercel Analytics + Speed Insights** (já default).
- **OpenTelemetry → Datadog** (ou equivalente) para traces de Stellar SDK + Etherfuse calls.
- **Logs estruturados** (`lib/stellar/log-error.ts` já existe) — expandir para audit-grade.
- **Alarme de saldo do funder** já implementado (commit `cc4c948` N-09); estender para alarme de saldo do issuer/distributor mainnet.

### 2.2 Data Model — extensões do schema atual

Schema existente (`prisma/schema.prisma`) está sólido. Adicionar:

```prisma
// M5 — Classes Sênior/Subordinada
enum ClassePLINARF {
  SENIOR
  SUBORDINADA
}

model HoldingPLINARF {
  id            String @id @default(cuid())
  investidorId  String
  investidor    Investidor @relation(fields: [investidorId], references: [id])
  classe        ClassePLINARF
  /// Quantidade de PLINA-RF da classe (subasset code: PLINARFS / PLINARFB).
  saldo         Decimal @db.Decimal(20, 7) @default(0)
  emissaoTxHash String?
  @@unique([investidorId, classe])
  @@index([classe])
}

// M1/M2 — Caminho preferencial vs. fallback
enum CaminhoCessao {
  API_ADMINISTRADORA  // Caminho preferencial (SLA contratual)
  CARTORIO_DIGITAL    // Fallback (taxa de anuência 1-3% embutida)
}

// Estender Cessao
model Cessao {
  // ... campos existentes
  caminhoCessao        CaminhoCessao @default(CARTORIO_DIGITAL)
  taxaAnuenciaBps      Int?          // 100-300 bps em fallback
  administradoraApiId  String?       // ref externo da administradora (quando API)
}

// M3/M4 — Tickets, jurisdição, investidor tipado
enum TipoInvestidor {
  INST_BR_QUALIFICADO
  INST_BR_PROFISSIONAL
  INST_INTERNACIONAL_PROFISSIONAL
}

model Investidor {
  // ... existente
  tipo            TipoInvestidor?
  jurisdicao      String?  // ISO 3166-1 alpha-2 ("BR", "US", "GB", "SG")
  ticketMinimoCheck Boolean @default(false)
  razaoSocial     String?
  cnpj            String?
  enderecoEntidade Json?
}

// M5 — Fechamento NAV diário (auditoria)
model NavSnapshot {
  id            String   @id @default(cuid())
  data          DateTime @unique  // 1 por dia (UTC-3 close)
  navTotal      Decimal  @db.Decimal(20, 2)
  navPorToken   Decimal  @db.Decimal(20, 7)
  tokensVivos   Decimal  @db.Decimal(20, 7)
  classeSeniorNav Decimal @db.Decimal(20, 2)
  classeSubordinadaNav Decimal @db.Decimal(20, 2)
  composicaoJson Json
  publishedTxHash String? // hash on-chain do snapshot
  @@index([data])
}

// M5 — Janela de liquidez (resgate)
model JanelaLiquidez {
  id          String   @id @default(cuid())
  abreEm      DateTime
  fechaEm     DateTime
  capTotal    Decimal? @db.Decimal(20, 2)  // teto de resgate
  consumido   Decimal  @db.Decimal(20, 2) @default(0)
  status      String   @default("AGENDADA")  // AGENDADA, ABERTA, FECHADA
  @@index([abreEm])
}
```

### 2.3 On-chain layer

**Asset structure:**
- `PLINARFS` (Sênior) — issuer flags: `AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED`
- `PLINARFB` (Subordinada) — mesmas flags
- `TESOURO` — asset bridge da Etherfuse (BRL on-chain), trustline pré-requisito
- `USDC` / `EURC` — Circle, trustlines opcionais para investidor internacional

**Operações:**
- **Emissão** (mint): `buildDistributionTx` (já existe em `lib/stellar/transactions.ts`) — estender para aceitar `assetCode` (Sênior vs. Subordinada).
- **Resgate** (burn): payment do holder → distributor; já implementado em `lib/services/liquidacao.ts`. Estender para janela + classe.
- **Clawback**: 4 hipóteses (`MotivoClawback` enum). Não muda.
- **Audit memo-hash**: padrão atual mantido. Cada estado crítico (`COTA_VALIDADA`, `CESSAO_ASSINADA`, etc.) gera `Memo.hash` de auto-pagamento na conta operacional.

**Soroban (M7):**
- Contrato `waterfall.rs`: recebe distribuição periódica do pool, distribui via cascata:
  1. Despesas operacionais (mgmt fee 2% a.a. proporcional)
  2. Yield prometido à classe Sênior (CDI+x% BR / SOFR+y% intl)
  3. Resto vai para Subordinada (Plina como skin-in-the-game)
- Contrato `nav_oracle.rs`: publica `NavSnapshot` diário on-chain (escrito apenas pelo issuer multisig).

### 2.4 KYC / Anchors

**SEP-compliance (já parcialmente em uso via Etherfuse):**
| SEP | Função | Provider hoje | Provider mainnet |
|---|---|---|---|
| SEP-10 | Web auth Stellar | — | Etherfuse / próprio |
| SEP-12 | KYC padronizado | Etherfuse (BR) | + MoneyGram (US), Settle (EU) |
| SEP-24 | Onramp/offramp hosted | Etherfuse (PIX↔TESOURO) | Etherfuse (BR) / Circle (USDC) |
| SEP-38 | Cotação FX | Etherfuse | Multi-anchor por jurisdição |

**Trilhas de onboarding** (alinhar UI ao mockup):
1. **Institucional BR** — Plina white-label → Etherfuse SEP-12 (business) → Suitability CVM 30 → assinatura termo FIDC (DocuSign) → trustlines TESOURO+PLINARF.
2. **Internacional Profissional** — Plina white-label → seletor de jurisdição → anchor regional SEP-12 → trustline USDC/EURC → SEP-38 → SEP-24 → trustline PLINARF.

### 2.5 FX & Pricing

- **Investidor BR**: BRL → TESOURO (1:1 via Etherfuse) → PLINARF.
- **Investidor Internacional**: USDC/EURC → quote SEP-38 → TESOURO → PLINARF. Atomicidade via swap envelope (já em design — `docs/2026-05-18-quote-binding-and-atomic-swap.md`).
- **Preço base**: R$ 1,0000 / PLINARF, ajustado diariamente pelo `NavSnapshot.navPorToken`.
- **Quote binding**: já implementado (`Quote.submitXdrHash @unique`, N-12 round explícito) — manter padrão para todo write path.

### 2.6 Segurança operacional (já parcialmente implementado)

| Controle | Status | Origem |
|---|---|---|
| Zod strict em todos os bodies | ✅ | C-01..C-07 |
| Rate-limit em rotas P0 | ✅ | C-06 |
| `withAuth` em `/api/investidor/**` | ✅ | F-02 + lint enforce |
| `x-plina-admin` header em POST admin | ✅ | N-10/N-11 (`e24620a`) |
| CSRF token admin | ✅ | `requireAdminCsrf` |
| Audit log append-only + privyId | ✅ | EventoAudit |
| Idempotência (privyId, quote, xdrHash) | ✅ | Schema |
| CPF normalizado + synthetic flag | ✅ | N-14 |
| Cap diário do funder + alarme | ✅ | N-09 (`cc4c948`) |
| Hash on-chain de cessão | ✅ | N-13 (`2f9764b`) |
| **Migração de admin para Clerk** | ⏳ | M0 |
| **Custódia Fireblocks de issuer/dist** | ⏳ | M0 |
| **Sign-off de DocuSign real** | ⏳ | M1 |
| **OFAC/sanctions check no KYC** | ⏳ | M3 |

---

## 3. Modelo Econômico/Financeiro

### 3.1 Estrutura de classes

Citando o pitch §6 e o mockup:

**Classe Sênior (PLINARFS)**
- Direito preferencial no waterfall.
- Yield alvo: **CDI + x%** (BR) / **SOFR + y%** (internacional). `x` e `y` calibrados por safra do pool.
- Rating em processo (M6).
- Maioria do AUM (target ~80% — confirmar com CEO).

**Classe Subordinada (PLINARFB)**
- Absorve primeiras perdas.
- Mantida majoritariamente pela Plina como **skin-in-the-game** (whitepaper).
- Pode ser oferecida a investidores qualificados que aceitem risco superior em troca de yield potencialmente maior.

### 3.2 NAV

```
NAV_total(t) = Σ (valor_realizável_cota_i × prob_realização_i × fator_desconto_temporal_i)
             + caixa_TESOURO_não_aplicado(t)
             − provisões(t)

NAV_por_token(t) = NAV_total(t) / tokens_vivos(t)

NAV_classe_Sênior(t) = NAV_total(t) × peso_Sênior(t)  [via waterfall]
NAV_classe_Subordinada(t) = NAV_total(t) − NAV_classe_Sênior(t)
```

- `valor_realizável_cota_i`: já calculado em `lib/services/pool.ts:navDaCota`. Manter.
- `fator_desconto_temporal_i`: refletir status de estoque (VERDE/AMARELO/VERMELHO/BAIXA). Em VERMELHO aplicar haircut. Em BAIXA reconhecer perda.
- Snapshot diário às 18:00 BRT (após fechamento do mercado de consórcio); persistido em `NavSnapshot` e publicado on-chain via `nav_oracle.rs` (M7) ou via memo-hash (interim).

### 3.3 Waterfall (cascata de pagamentos)

Em cada janela de liquidez (`JanelaLiquidez`) ou evento de distribuição:

1. **Despesas operacionais** — mgmt fee 2% a.a. pró-rata + custos de prestadores (auditor, custodiante).
2. **Yield Sênior** — pagamento até atingir CDI+x% / SOFR+y% no período.
3. **Excedente** — performance fee 20% para Plina (sobre o excedente do benchmark).
4. **Sobra final** — alocada à classe Subordinada (Plina + qualquer investidor subordinado).

**Janela de inadimplência:** se uma cota entra em `INADIMPLENCIA`, o valor é debitado primeiro do NAV da classe Subordinada. Se Subordinada não cobrir, a Sênior absorve (mas isso aciona ratings/disclosure).

### 3.4 Deságio (pricing do cotista)

Fórmula de oferta (M1, estender `lib/services/originacao.ts:gerarOferta`):

```
desagio_total = desagio_base(prazo, administradora, tipoBem)
              + spread_curva_yield_pool
              + (caminho_cessao == CARTORIO_DIGITAL ? taxa_anuencia_bps : 0)
              + margem_operacional_Plina

valor_liquido_vendedor = valor_face × (1 − desagio_total)
```

- `desagio_base`: tabela por administradora × prazo (Embracon, Caixa, Bradesco, Porto Seguro etc.). Configurável (Edge Config / DB seed).
- `spread_curva_yield_pool`: derivado do yield alvo da Sênior + custo de capital.
- `taxa_anuencia_bps`: **100-300 bps** quando fallback (cartório digital), explicitado ao cedente na oferta.
- `margem_operacional_Plina`: o spread bruto do produto — receita principal (pitch §6).

### 3.5 Receita

| Fonte | Base | Taxa | Reconhecimento |
|---|---|---|---|
| Spread de originação | Por operação | `desagio_total − custo_real_realização` | Quando cota REALIZADA |
| Mgmt fee | AUM | 2% a.a. | Pró-rata diário (subtraído do NAV) |
| Performance fee | Excedente sobre benchmark | 20% | Em janela de liquidez |

### 3.6 Tickets e limites

| Persona | Mínimo | Máximo | Validação |
|---|---|---|---|
| Inst. BR Qualificado | R$ 500k | R$ 10M | Auto-declaração + Suitability CVM 30 + ticket check no onboarding |
| Inst. BR Profissional | R$ 1M | sem teto | Mesmo |
| Inst. Internacional | US$ 100k | US$ 5M | KYC anchor + ticket check |

Validação implementada em `Investidor.ticketMinimoCheck` + guard nas rotas `/api/investidor/quote` e `/api/investidor/buy/*`.

---

## 4. Segurança & Compliance — visão consolidada

### 4.1 Camadas defensivas

```
┌─────────────────────────────────────────────────────────┐
│ Edge: Vercel Firewall (WAF) + BotID + rate-limit IP    │
├─────────────────────────────────────────────────────────┤
│ App: Zod strict, withAuth, CSRF admin, idempotência    │
├─────────────────────────────────────────────────────────┤
│ Domain: ticket check, KYC status, ownership checks     │
├─────────────────────────────────────────────────────────┤
│ Off-chain: PII em Neon Brasil + LGPD audit             │
├─────────────────────────────────────────────────────────┤
│ On-chain: clawback (4 hipóteses), auth flags, audit    │
│           memo-hash, multisig issuer (Fireblocks)      │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Matriz regulatória

| Vetor | Controle | Owner externo |
|---|---|---|
| Estrutura jurídica | FIDC formal CVM 175 | Administrador fiduciário registrado |
| Custódia direito creditório | Custodiante regulado CVM | A contratar (M6) |
| Auditoria | Big Four | A contratar (M6) |
| Rating | Agência de rating | A contratar (M6) |
| KYC/AML cedente | DocuSign + e-CPF + screening | DocuSign + provedor AML |
| KYC/AML investidor BR | Etherfuse anchor regulada | Etherfuse |
| KYC/AML investidor intl | Anchor SEP-12 por jurisdição | MoneyGram / Settle / Bitso |
| Custódia de chaves operacionais | Fireblocks (multisig + policy engine) | Fireblocks |
| Reporte mensal NAV + composição | NavSnapshot publicado + dashboard | Plina |
| Auditoria on-chain pública | Stellar Expert | Stellar Foundation |
| LGPD | PII off-chain, hash on-chain | Plina (DPO interno) |

### 4.3 Sanctions / OFAC / PEP

KYC anchor cobre BR (Etherfuse) e intl (MoneyGram/Settle). Plina adiciona camada própria de **screening contínuo** (M6):
- Lista OFAC + União Europeia + ONU.
- PEPs (Politically Exposed Persons) BR via Receita Federal + outras fontes.
- Re-check trimestral; alerta → review humano antes de qualquer payment.

---

## 5. Roadmap por Módulos

Os módulos abaixo são **incrementos de valor entregáveis independentemente**. Dependências explicitadas. Cada módulo tem **Objetivo, Fluxos cobertos, Features, Aceites mensuráveis, e Riscos**.

> **Convenção de aceite:** todo aceite deve ser (a) executável em CI (testes unit/e2e) ou (b) verificável manualmente em staging com checklist. Aceites sem critério mensurável são reescritos.

---

### M0 — Foundation (Mainnet readiness)

**Objetivo.** Preparar o app que hoje roda em testnet POC para suportar mainnet sem refactor estrutural. Substitui secrets em env por Fireblocks, migra admin para Clerk, e levanta observabilidade de produção.

**Dependências.** Nenhuma (é base de tudo).

**Fluxos cobertos.**
- Cutover testnet → mainnet via feature flag `STELLAR_NETWORK=public` + `MAINNET_ENABLED=true`.
- Reemissão dos assets PLINARFS / PLINARFB no issuer mainnet com flags `AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED`.
- Admin login via Clerk (não cookie POC).

**Features.**
- F-M0-1: Custódia Fireblocks de `issuerSecret` e `distributorSecret`. SDK Fireblocks signing replacing `Keypair.fromSecret`.
- F-M0-2: Migração `AdminSession` → Clerk (manter `EventoAudit.privyId` rastreabilidade equivalente).
- F-M0-3: OpenTelemetry traces em `lib/stellar/**` e `lib/anchors/**`.
- F-M0-4: Alerta de saldo issuer/distributor (extensão do alarme do funder N-09).
- F-M0-5: Vercel Firewall (WAF) com regras: rate-limit IP em `/api/*`, bloqueio de bots não-verificados em forms de lead via BotID.
- F-M0-6: Edge Config feature flags (`MAINNET_ENABLED`, `INTL_INVESTOR_FLOW`, `SOROBAN_WATERFALL`).
- F-M0-7: Runbook de incident response (clawback, pause emissão, rotate Fireblocks policy).

**Aceites.**
1. `npm run test:unit && npm run test:e2e` passa em mainnet config com Fireblocks mockado.
2. Assets `PLINARFS` e `PLINARFB` visíveis no Stellar Expert mainnet com 3 flags ativas.
3. Admin login funciona via Clerk, e `/api/admin/*` continua exigindo `x-plina-admin` + CSRF.
4. Alerta de saldo issuer dispara em staging quando saldo < threshold definido.
5. Runbook documentado em `docs/runbooks/` com 4 cenários: clawback, pause, rotate-keys, incident.
6. Vercel Firewall ativo; teste de carga (k6 ou similar) confirma rate-limit em `/api/vender/lead` e `/api/comprar/lead`.

**Riscos.** Fireblocks tem onboarding lento (KYB próprio) — começar em paralelo agora. Clerk requer mapeamento de admins existentes.

---

### M1 — Fluxo Cotista produção (Vender com Pix 48h real + DocuSign real)

**Objetivo.** Levar `/vender` da POC testnet para produção mainnet: DocuSign real, Pix real, hash on-chain de cessão, e suporte ao caminho preferencial (API administradora) vs. fallback (cartório digital com taxa de anuência).

**Dependências.** M0.

**Fluxos cobertos (mockup §2 — Para Cotistas).**
1. **Envio da cota** — formulário com adm./número/valor face/data contemplação. Já existe.
2. **Validação jurídica automática** — call à API da administradora (M1.A) **ou** queue de validação manual via cartório digital (M1.B).
3. **Proposta & negociação** — `gerarOferta` atualizado com caminho de cessão; oferta 24h.
4. **Cessão digital real** — DocuSign envelope com template "Termo de Cessão de Direitos Creditórios", assinatura e-CPF do cedente, hash do PDF assinado.
5. **Depósito Pix real** — execução Pix via PSP regulado (Banco real, não simulado).
6. **Cessão concluída** — link Stellar Expert + comprovante.

**Features.**
- F-M1-1: **DocuSign API**: client em `lib/integrations/docusign.ts`. Envelope creation, polling de status (webhook + fallback poll), download de PDF assinado, SHA-256 → memo-hash on-chain.
- F-M1-2: **Pix real**: integração com PSP (provedor a definir — Stark Infra, BTG OpenFinance ou similar). Idempotência via `Pagamento.idempotencyKey @unique`.
- F-M1-3: **Caminho preferencial**: client B2B genérico em `lib/integrations/administradoras/`. Adapter por administradora (Embracon, Caixa, Bradesco, Porto, Itaú). Suporte mínimo a verificar contemplação + adimplência + titularidade.
- F-M1-4: **Caminho fallback**: queue de validação manual (operador interno valida documentos) + taxa de anuência embutida (100-300 bps configurável por administradora).
- F-M1-5: UI `/vender` atualizada com etapas explícitas: Cadastro & KYC · Validação · Proposta · Cessão · Pix · Concluído (alinhar com terminal-mode do mockup).
- F-M1-6: Webhook DocuSign assinado (verificar HMAC), idempotente, registra `Cessao.assinadaEm` + memo-hash.
- F-M1-7: Email transacional ao cedente em cada transição (Resend).
- F-M1-8: PDF de comprovante (Vercel Blob privado) com link assinado de curto prazo.

**Aceites.**
1. E2E em staging: lead → oferta → DocuSign sandbox → Pix sandbox PSP → cessão concluída em < 48h end-to-end (teste cronometrado).
2. Hash do PDF DocuSign assinado **é idêntico** ao `payloadHash` do `EventoAudit.CESSAO_ASSINADA`, e ao `Memo.hash` da tx Stellar referenciada. Test e2e valida.
3. Para administradora com API integrada: validação automática completa < 30s. Para fallback: queue manual com SLA documentado.
4. Pix sandbox PSP executado com idempotência: retry da mesma `Pagamento.id` não duplica débito.
5. UI mostra trilha de auditoria com link `stellar://tx/...` clicável (abre Stellar Expert).
6. Webhook DocuSign valida assinatura HMAC e rejeita payloads adulterados (test unit + e2e).
7. Rate-limit `/api/vender/lead` (Vercel Firewall) testado com k6 — bloqueia >10 req/min/IP.
8. Cobertura de testes ≥ 70% nas novas funções de `lib/integrations/docusign.ts` e `lib/integrations/administradoras/*`.

**Riscos.** Onboarding DocuSign exige conta empresarial + e-CPF da Plina. PSP Pix exige conta corrente PJ ativa. Acordos com administradoras (API B2B) demoram meses — iniciar M1.A em paralelo, mas M1.B (fallback) é unblocker.

---

### M2 — Fluxo Comprador produção (Comprar Cota com carta de crédito real)

**Objetivo.** Levar `/comprar` ao MVP mainnet: reserva 72h, sinal real (Pix), assinatura e-CPF do comprador, transferência de titularidade real na administradora (carta de crédito), e captura de spread.

**Dependências.** M0, M1 (infraestrutura DocuSign + administradoras compartilhada).

**Fluxos cobertos (mockup §4 — Comprar Cota).**
1. **Buscar cota** — listagem com filtros (tipo de bem, desconto mínimo, valor de face). Já existe parcialmente em `/cotas`.
2. **Selecionar cota** — detalhe + simulador "Você paga vs. Economia".
3. **Forma de pagamento** — TED/Pix/financiamento próprio (M2.1 só Pix; financiamento em fase posterior).
4. **Cartório digital com e-CPF** — DocuSign do termo de cessão Plina → comprador.
5. **Direito creditório transferido** — API administradora (M1.A) ou queue manual (M1.B).
6. **Comprador recebe carta de crédito** — confirmação na administradora, email + comprovante.

**Features.**
- F-M2-1: UI `/comprar` com etapas (manter calculadora comparativa atual).
- F-M2-2: `Reserva` com sinal real Pix (substituir `sinalSimulado`); expiração mantida em 72h.
- F-M2-3: Termo de cessão Plina → comprador via DocuSign (template separado de M1).
- F-M2-4: `RealizacaoCaminho` (já existe — caminho A) com `valorRealizado`, `spread` recalculados em mainnet.
- F-M2-5: Notificação ao comprador (email + dashboard `/minha-compra`) quando carta de crédito disponível.
- F-M2-6: Cancelamento de reserva (já existe — N-13 — manter idempotente e auditado).
- F-M2-7: Anti-fraude: limite de tentativas de reserva por documento (CPF/CNPJ) em janela 24h, validação Receita.

**Aceites.**
1. E2E: lead → reserva → sinal Pix sandbox → cessão comprador → realização cota → status REALIZADA + `caminho=A_REVENDA`.
2. `Reserva.status=ATIVA` expira automaticamente em 72h e libera `Cota.status=DISPONIVEL` via cron (cron job idempotente).
3. Comprador recebe email com link assinado para comprovante (Vercel Blob privado) em ≤ 5 min após realização.
4. Para administradora com API integrada: transferência de titularidade automática < 10 min. Fallback: queue manual com SLA.
5. Spread realizado (`RealizacaoCaminho.spread`) bate com pool service: `valorRealizado − custoAquisicao`. Teste de precisão decimal.
6. Anti-fraude: tentativa de 4ª reserva pelo mesmo CPF em 24h é bloqueada com erro 429 + audit log.
7. UI exibe "Você paga R$ X / Economia R$ Y" calculado server-side (bound como `Quote`), não computado client-side.

**Riscos.** Variação de processo entre administradoras pode forçar M2 a esperar M1 completo. Mitigação: lançar M2 apenas para administradoras já integradas em M1.

---

### M3 — Fluxo Investidor Institucional BR (FIDC + classes + tickets)

**Objetivo.** Habilitar `/investir` para investidor BR com onboarding institucional formal: Suitability CVM 30, ticket mínimo R$ 500k, escolha de classe Sênior/Subordinada, assinatura termo FIDC via DocuSign.

**Dependências.** M0. Idealmente M1+M2 (lado de originação ativo para gerar lastro).

**Fluxos cobertos (mockup §3 — Para Investidores · trilha BR).**
1. **Onboarding institucional BR** — coleta CNPJ, razão social, endereço, AUM declarado, perfil regulatório (qualificado/profissional).
2. **Suitability CVM 30** — questionário + persistência da prova de adequação.
3. **KYC** — Etherfuse SEP-12 business + screening Plina (OFAC/PEP).
4. **Assinatura termo FIDC** — DocuSign template "Termo de Adesão FIDC PLINA-RF".
5. **Escolha de classe** — Sênior (preferencial) ou Subordinada (skin-in-game compartilhado com Plina).
6. **Alocação** — quote BRL → TESOURO → PLINARFS/PLINARFB. Atomicidade via swap (Phase 2 do plano existente).
7. **Confirmação & custódia** — wallet Privy do investidor recebe; dashboard `/minha-posicao` mostra saldo + NAV.

**Features.**
- F-M3-1: Schema `Investidor.tipo`, `jurisdicao`, `cnpj`, `razaoSocial`, `enderecoEntidade`, `ticketMinimoCheck`.
- F-M3-2: `HoldingPLINARF` por classe.
- F-M3-3: Issuer mainnet emite `PLINARFS` e `PLINARFB` com flags. Distributor configurado.
- F-M3-4: UI seletor de classe com explicação clara: yield alvo, risco, posição no waterfall. Disclaimer "sem promessa de rentabilidade".
- F-M3-5: Suitability CVM 30 — questionário (perfil arrojado/moderado, AUM, experiência), persistido em `Investidor.suitabilityJson`.
- F-M3-6: Ticket check server-side antes de aceitar `/quote` (R$ 500k inst. qualificado, R$ 1M profissional).
- F-M3-7: DocuSign template "Adesão FIDC" assinado pelo representante legal da entidade (e-CPF + procuração).
- F-M3-8: `/minha-posicao` mostra saldo por classe, NAV/token corrente, último snapshot, e fila de janela de liquidez.

**Aceites.**
1. Investidor com CNPJ válido completa onboarding em < 15 min em staging (Etherfuse sandbox + DocuSign sandbox).
2. Ticket abaixo de R$ 500k é rejeitado server-side com erro 400 + audit log (test e2e).
3. Holder de classe Sênior tem `HoldingPLINARF.classe=SENIOR` + trustline `PLINARFS` aprovada pelo issuer (test e2e).
4. Suitability completada antes da primeira alocação; sem suitability, `/quote` retorna 403.
5. Swap atômico BRL → TESOURO → PLINARFS executa em uma única tx Stellar (multi-op envelope). Test e2e valida operações esperadas.
6. `/api/investidor/quote` aplica round explícito (já existe — N-12) e binding via `Quote.submitXdrHash`.
7. Stellar Expert mostra emissão `PLINARFS` para a wallet do investidor com memo-hash referenciando `EventoAudit.TOKEN_EMITIDO`.

**Riscos.** FIDC formal exige administrador fiduciário registrado — bloqueador para mainnet real. M3 pode rodar em "modo soft-launch" pré-FIDC com sociedade limitada + termo de cessão direto (capítulo de Fase 0 do pitch). Decisão estratégica com CEO + jurídico.

---

### M4 — Fluxo Investidor Institucional Internacional (SEP intl + USDC/EURC)

**Objetivo.** Habilitar `/investir` trilha internacional: seletor de jurisdição, KYC anchor SEP-12 não-BR, ticket US$ 100k-5M, settlement via USDC ou EURC.

**Dependências.** M0, M3 (compartilha schema e UI base).

**Fluxos cobertos (mockup §3 — Para Investidores · trilha Intl).**
1. **Seletor de jurisdição** — US, EU, UK, SG, MX (lista inicial). Cada jurisdição vincula a um anchor SEP-12.
2. **KYC anchor regional** — MoneyGram (US), Settle (EU/UK), Bitso (LATAM), conforme jurisdição.
3. **Trustlines USDC/EURC** — pré-requisito.
4. **SEP-38 quote** — USDC/EURC → TESOURO BRL.
5. **SEP-24 settlement** — onramp se necessário; depósito direto se já tem USDC/EURC.
6. **Atomic swap** — USDC → TESOURO → PLINARFS/PLINARFB.
7. **Roadshow CTA** — para tickets ≥ US$ 1M, agendar reunião com founders (Calendly embed) antes do onboarding (modelo founder-led declarado).

**Features.**
- F-M4-1: Multi-anchor abstração em `lib/anchors/` (já existe estrutura) — adapter por jurisdição.
- F-M4-2: Seletor de jurisdição no UI, com validação cruzada via IP geolocation (alerta, não bloqueio).
- F-M4-3: Suporte a USDC e EURC: trustlines, payments, swap paths.
- F-M4-4: SEP-38 quote multi-currency.
- F-M4-5: Ticket check US$ 100k mínimo.
- F-M4-6: Calendly embed em `/investir` para "Solicitar Roadshow" se ticket declarado > US$ 1M (qualificação manual founder-led).
- F-M4-7: Suporte EN/PT-BR no UI (i18n com next-intl ou similar). EN é default para essa trilha.
- F-M4-8: Disclaimer regulatório por jurisdição (Reg D para US, MiFID II para EU).

**Aceites.**
1. Investidor US completa onboarding via MoneyGram sandbox em < 30 min, recebe `PLINARFS` em wallet Privy.
2. Investidor EU completa onboarding via Settle sandbox, settle em EURC.
3. Swap atômico USDC → TESOURO → PLINARFS executa em uma única tx (multi-op envelope).
4. SEP-38 quote retorna preço e fee dentro do prazo de validade (tested no anchor sandbox).
5. UI EN/PT funciona; switch de idioma persiste por sessão.
6. Calendly aparece para ticket > US$ 1M; abaixo, fluxo self-service standard.
7. Disclaimer regulatório por jurisdição renderizado e exigido aceite antes do KYC.

**Riscos.** Cada anchor regional tem rate de aprovação KYC distinto. Mitigação: começar com MoneyGram (US, maior volume) e expandir progressivamente.

---

### M5 — PLINA-RF como ativo distribuível (Ficha técnica, NAV, eventos públicos)

**Objetivo.** Levar `/pool` ao nível de "ficha técnica institucional": NAV diário publicado, composição do pool, eventos on-chain rastreáveis no Stellar Expert, link para prospecto FIDC.

**Dependências.** M0. Aproveitável já em soft-launch.

**Fluxos cobertos (mockup §5 — PLINA-RF).**
- Métricas em tempo real: AUM, NAV total, NAV/token, tokens vivos por classe, spread realizado.
- Composição do pool (cotas em CSV/JSON download).
- Eventos on-chain: lista de mint/burn/clawback com links Stellar Expert.
- Mecanismos de cessão: preferencial vs. fallback (UI explicativa).
- Download de prospecto FIDC (PDF).
- Status de classes Sênior e Subordinada.

**Features.**
- F-M5-1: `NavSnapshot` diário via cron (18:00 BRT). Persistência + publicação on-chain via memo-hash (M7 substitui por Soroban oracle).
- F-M5-2: Endpoint público `/api/pool/summary` ampliado: classes, NAV histórico (últimos 90 dias), spread realizado, distribuição por administradora.
- F-M5-3: UI `/pool` expandida: gráfico de NAV, composição por tipo de bem, eventos on-chain (paginação).
- F-M5-4: Prospecto FIDC PDF em Vercel Blob público + link permanente.
- F-M5-5: Página `/pool/eventos` com lista de operações on-chain (filtros: tipo, data) e links diretos para Stellar Expert.
- F-M5-6: Export CSV/JSON da composição do pool para due diligence de investidor.

**Aceites.**
1. Cron diário publica `NavSnapshot` antes das 19:00 BRT; falha → alarme.
2. `/api/pool/summary` retorna composição compatível com OpenAPI documentado, com `Cache-Control` apropriado (60s).
3. Gráfico de NAV mostra 90 dias com pelo menos 1 ponto por dia (gaps logados, não silenciados).
4. Prospecto PDF acessível em URL pública estável; versão registrada em `EventoAudit.PROSPECTO_PUBLICADO`.
5. Filtros em `/pool/eventos` funcionam server-side (paginação cursor).
6. Cada evento on-chain linka para Stellar Expert mainnet correto.
7. Teste e2e: e2e/pool-api.spec.ts cobre composição e NavSnapshot.

**Riscos.** NAV diário precisa de prestadores formais (auditor) confirmando valuation antes da publicação pública oficial. Soft-launch: publicar com label "preliminar" até auditor formalizado em M6.

---

### M6 — Compliance surface (Prestadores nominais + CVM 175 + monitoring)

**Objetivo.** Levar `/compliance` (e o footer regulatório) de declaração para evidência: prestadores nominais com link para registro CVM, parecer jurídico publicado, política de KYC/AML detalhada, e monitoring contínuo (OFAC/PEP).

**Dependências.** M0. Encadeada com decisões de M3 (FIDC formal).

**Fluxos cobertos (mockup §6 — Compliance).**
- Regulação: links para registros CVM, BACEN, parecer jurídico.
- Custódia: prestador nominal + comprovante.
- Administrador fiduciário + auditor: nomes + links.
- Controles on-chain: política de clawback (já existe em `/politica-clawback`).
- Monitoring contínuo: OFAC/PEP/sanctions screening.

**Features.**
- F-M6-1: Página `/compliance` expandida (atualmente apenas `/politica-clawback`).
- F-M6-2: Schema `PrestadorRegulado` (administrador fiduciário, custodiante, auditor, agência de rating, anchor) com `nome`, `cnpj`, `numeroRegistroCVM`, `urlVerificacao`.
- F-M6-3: Worker semanal de screening OFAC/PEP em base de investidores + cedentes. Disparo de alerta humano em hit.
- F-M6-4: Política de privacidade LGPD + página `/lgpd` com formulário de direitos do titular.
- F-M6-5: Dashboard interno `/admin/compliance` com fila de alertas (KYC pendente, OFAC hit, suitability vencida).
- F-M6-6: Parecer jurídico CVM 175 em Vercel Blob público.
- F-M6-7: Política de gestão de riscos publicada (waterfall, classes, hipóteses de clawback).

**Aceites.**
1. `/compliance` mostra 4 pilares com prestadores nominais (links externos verificáveis).
2. Screening OFAC roda semanalmente; teste em staging valida hit-rate em lista mockada.
3. Política LGPD acessível em todas as páginas (link no footer); formulário `/lgpd` recebe e roteia para DPO.
4. Admin dashboard mostra fila de alertas em tempo real; ação manual gera `EventoAudit.COMPLIANCE_REVIEW`.
5. Parecer jurídico tem versão + hash registrado on-chain.
6. Política de gestão de riscos publicada; menciona explicitamente waterfall, hipóteses de clawback, custodiante, e regime de KYC.
7. Lighthouse a11y ≥ 95 em `/compliance` e `/lgpd` (linha-base PRODUCT.md).

**Riscos.** Contratação de prestadores externos (administrador fiduciário, custodiante, auditor Big Four) tem tempo de fechamento ≥ 3 meses cada. M6 pode entrar com prestadores "intent" se ainda não contratados, mas isso degrada o valor da página.

---

### M7 — Soroban Waterfall (Smart contract de distribuição)

**Objetivo.** Substituir cálculo de waterfall em Postgres (`lib/services/pool.ts`) por contrato Soroban auditável. Atender o claim do mockup: "Estrutura FIDC sob CVM 175 · Waterfall de distribuição via Soroban".

**Dependências.** M5 (NAV snapshot estável), M3 (classes em produção).

**Fluxos cobertos.**
- Cada janela de liquidez ou evento de distribuição executa contrato Soroban que valida e propaga payments.
- NavSnapshot diário publicado via Soroban oracle (escritor: issuer Fireblocks multisig).
- Auditoria pública via Stellar Expert mostra contrato + execuções.

**Features.**
- F-M7-1: Contrato `waterfall.rs` em Soroban com lógica:
  1. Deduz mgmt fee pro-rata.
  2. Paga yield Sênior até atingir CDI+x% / SOFR+y%.
  3. Aloca performance fee 20% sobre excedente para Plina.
  4. Resto vai para Subordinada.
- F-M7-2: Contrato `nav_oracle.rs` com slot diário (write-once por data, escritor = issuer multisig).
- F-M7-3: Auditoria formal do código Soroban por firma externa (custo: ~US$ 30-50k).
- F-M7-4: Test suite Mollusk ou SVM para contratos.
- F-M7-5: UI `/pool` linka para endereço dos contratos no Stellar Expert.
- F-M7-6: Migração: backfill de NavSnapshot histórico para oracle (com label "histórico, não validado on-chain").

**Aceites.**
1. Contrato `waterfall.rs` deployed em mainnet; primeiro execution lookup em Stellar Expert.
2. Auditoria externa concluída sem findings críticos; relatório publicado.
3. Cálculo de waterfall produz mesmo resultado que `lib/services/pool.ts` para o mesmo input (diff test em CI por 30 dias antes do cutover).
4. Cron diário publica `NavSnapshot` via oracle (não mais memo-hash).
5. `EventoAudit.WATERFALL_EXECUTADO` registra cada execução com `stellarTxHash` do contrato.
6. Test suite Soroban tem ≥ 90% coverage do contrato.

**Riscos.** Soroban smart contracts são código com superfície de risco. Auditoria externa é não-negociável. CTO (Thais) tem expertise em Soroban — mas alocação de tempo precisa ser bloqueada para isso (estimativa: 6-10 semanas de eng + 4-6 semanas de auditoria).

---

### M8 — Observabilidade & Ops (Reporting, alertas, NAV diário, runbooks)

**Objetivo.** Suportar mainnet 24/7 com observability de produção, alertas acionáveis e runbooks de incidente.

**Dependências.** M0.

**Fluxos cobertos.**
- Logs estruturados de toda operação Stellar / Etherfuse / DocuSign / Fireblocks.
- Métricas: latência, error rate, AUM, NAV, alertas de saldo issuer/distributor/funder.
- Reporting mensal automatizado para investidores (NAV, posições, fees, eventos).
- Runbooks: clawback, pause emissão, rotate Fireblocks, incident response.

**Features.**
- F-M8-1: OpenTelemetry em todas as integrações externas; traces visíveis em Datadog/equivalente.
- F-M8-2: Dashboard ops em `/admin/ops` com: AUM, NAV diário, saldo issuer/dist/funder, transações pendentes, queue de DocuSign/Etherfuse/PSP.
- F-M8-3: Alertas configuráveis (PagerDuty/Opsgenie): saldo issuer < X, error rate > Y, polling Etherfuse stuck > Z.
- F-M8-4: Reporting mensal por email aos investidores (extrato + NAV history + lista de eventos).
- F-M8-5: Runbooks publicados em `docs/runbooks/`:
  - Clawback execution (com checklist legal).
  - Pause emissão (toggle Edge Config + invalidate cache).
  - Rotate Fireblocks key.
  - DocuSign provider down (fallback manual).
  - Etherfuse stuck (cancellation + refund flow).
- F-M8-6: Status page público (uptime, manutenções programadas).
- F-M8-7: Métricas de UX em `/vender` e `/comprar`: TTFB, conversão por etapa, drop-off.

**Aceites.**
1. Trace de uma `/api/investidor/buy/onramp/create` aparece em Datadog mostrando spans Etherfuse + Stellar.
2. Alerta de saldo issuer dispara em < 5 min do threshold; test fire em staging.
3. Reporting mensal enviado no dia 5 de cada mês; teste fixture valida formato + valores.
4. Runbook de clawback executado em staging em < 10 min (drill).
5. Status page publicado em status.plina.finance com SLA documentado.
6. Métricas UX visíveis em dashboard; queries SQL documentadas para conversão por etapa.

**Riscos.** Custo de observability tier-1 (Datadog) é significativo. Alternativa: Vercel Analytics + open-source stack. Definir budget com CEO.

---

### M9 — Mainnet Cutover (Coordenação final)

**Objetivo.** Trocar `STELLAR_NETWORK=public` em produção, com checklist de pre-launch executado, freeze de mudanças, e capacidade de rollback rápido se necessário.

**Dependências.** M0 + M1 + M3 + M5 + M6 + M8 (M2, M4, M7 podem rodar pós-cutover).

**Fluxos cobertos.**
- Pre-launch checklist (regulatório, técnico, ops, comunicação).
- Cutover gradual via Vercel Rolling Releases (canary 10% → 50% → 100%).
- Freeze de 2 semanas após cutover.
- Comunicação (CVM, parceiros, investidores LOI).

**Features.**
- F-M9-1: Pre-launch checklist em `docs/runbooks/mainnet-cutover.md` com 50+ itens.
- F-M9-2: Vercel Rolling Releases configurado para canary deployment.
- F-M9-3: Feature flags `MAINNET_ENABLED` controla cutover; rollback é toggle off + Vercel rollback.
- F-M9-4: Comunicado formal CVM (carta) registrando início de operação.
- F-M9-5: Email aos investidores LOI com link para onboarding mainnet.

**Aceites.**
1. Checklist 100% executado e assinado por CEO + CTO + jurídico.
2. Canary 10% roda 48h sem incident; expande para 50% por 48h; full em 24h.
3. Rollback testado em staging: toggle `MAINNET_ENABLED=false` reverte para testnet em < 5 min.
4. Carta CVM enviada e acknowledgment recebido.
5. Primeiro investidor LOI completa onboarding mainnet com sucesso (success criterion declarado).

**Riscos.** Cutover prematuro é risco existencial — falha visível mata o produto. Critério de "ready": **2 administradoras integradas** (M1), **3 prestadores formais contratados** (M6), **1 LOI institucional assinado** (pitch Fase 1 marco), **30 dias de testnet shadow-test sem incident crítico**.

---

## 6. Ordem de execução sugerida

**Trilha A (regulatório-bloqueante, longo lead time):** iniciar imediatamente em paralelo.
- Contratação de administrador fiduciário, custodiante, auditor Big Four (M6).
- Conta Fireblocks + onboarding KYB (M0).
- Conta DocuSign empresarial + e-CPF Plina (M1).
- Acordos B2B com primeira administradora (M1.A).
- Parecer jurídico CVM 175 finalizado (pitch Fase 0).

**Trilha B (engenharia, sequenciada):**
1. **M0 — Foundation** (4-6 semanas)
2. **M1 — Vender produção** (6-8 semanas; bloqueado por DocuSign + PSP onboarding)
3. **M3 — Investir BR** + **M5 — PLINA-RF** (paralelos, 6-8 semanas cada)
4. **M2 — Comprar produção** (4 semanas; reusa M1)
5. **M6 — Compliance** (3-4 semanas; bloqueado por trilha A)
6. **M8 — Ops** (contínuo durante 1-3)
7. **M9 — Cutover** (2 semanas + freeze 2)
8. **M4 — Investir Internacional** (pós-cutover; 6-8 semanas)
9. **M7 — Soroban Waterfall** (pós-cutover; 10-16 semanas)

**Estimativa total até mainnet cutover (M9):** ~5-6 meses se trilha A não atrasa.

---

## 7. Princípios de execução

1. **Fricção assimétrica é não-negociável.** `/` e `/investir` são institucionais (fricção alta = filtro de público). `/vender` e `/comprar` operam fricção mínima. Não tentar caber 4 vozes em uma página (PRODUCT.md §design-principle-5).
2. **Compliance é o produto, não o disclaimer.** CVM 175, FIDC, clawback aparecem em destaque editorial — não em letras pequenas no rodapé.
3. **Toda mudança de estado relevante grava `EventoAudit`.** Sem exceção. Hash on-chain via memo é o trilho de auditoria.
4. **PII off-chain. On-chain apenas hash, endereço, timestamp.** LGPD não é discutível.
5. **Idempotência em todo write path.** Padrão estabelecido (privyId, quote, xdrHash, walletProvisioning, liquidacaoSubmit). Mantido em código novo.
6. **Anti-padrão de `_type/_at/_ref` no payload do investidor.** Já existe strip em `/api/investidor/events` (N-17). Manter.
7. **Sem promessas de rentabilidade.** Todas as menções de yield são "alvo" ou "histórico"; disclaimer regulatório aplicado.
8. **Soroban entra onde Horizon não alcança.** Waterfall (M7) e smart account social recovery (Fase 2). Resto é Horizon nativo.
9. **Edge Config para feature flags.** Cutover, kill-switches, anchor selection.
10. **Lint-auth-guard é blocking em CI.** Toda nova rota `/api/investidor/**` precisa de `withAuth`.

---

## 8. Pendências para sponsor (CEO)

Decisões que travam parte do roadmap e exigem alinhamento com Fabrício:

1. **Fase 0 soft-launch sem FIDC formal?** Pitch §11 sugere iniciar com capital próprio dos sócios (operação privada Lei 11.795). Decidir: M3 espera FIDC formal ou roda em modo soft-launch?
2. **Mix-alvo Sênior/Subordinada.** Pitch sugere majoritariamente intl. Confirmar pesos para calibrar yield alvo.
3. **Custódia Fireblocks.** Custo + tempo de onboarding KYB. Aprovar budget.
4. **Auditoria Soroban externa (M7).** US$ 30-50k. Não-negociável tecnicamente, mas timing depende de mainnet ter volume justificável.
5. **Anchors internacionais (M4) — sequência.** Começar com MoneyGram (US) é menor risco. Confirmar.
6. **Status page público + reporting transparente.** Pitch fala em transparência total. Confirmar que NAV, AUM, eventos são públicos desde o cutover.

---

## 9. Apêndice — Mapa de referências

| Documento | Conteúdo |
|---|---|
| `Plina_Finance_Pitch.md` | Pitch v1.0 — visão, mercado, time, roadmap, captação |
| `PRODUCT.md` | Personas, brand, princípios de design, accessibility |
| `DESIGN.md` | Design tokens, vibe terminal-financeiro |
| `ONBOARDING.md` | Setup dev + convenções |
| `prisma/schema.prisma` | Schema canônico (estender, não substituir) |
| `docs/security-audit-*.md` | Bundles C/F/N — controles já implementados |
| `docs/2026-05-18-quote-binding-and-atomic-swap.md` | Plano de atomicidade de emissão |
| `docs/video-integracao-roteiro.md` | Documentação do path Etherfuse + Stellar |
| `docs/brand_guidelines.pdf` | Brand v1.0 |
| Mockup do fundador | https://mockup-plina.lovable.app/ |
| Whitepaper Plina | `/home/dalekthai/Documentos/Workspace/Plina/PlinaFinance-1.pdf` (referenciado no schema) |

---

*Fim do PRD v1.0. Próximo passo: revisão com CEO + jurídico, depois quebra dos módulos M0..M9 em épicos/issues no tracker.*
