# Plina — Project Context

> Contexto persistente do projeto, carregado na ativação das personas BMAD (Nicole, Justin,
> Tyler, Kaan, Elliot, Bri) e do party-mode. Fatos estáveis apenas — status volátil vive em
> `docs/PRD-plina-v1.md` e `docs/ACOMPANHAMENTO-CEO.md`.
>
> **Última sincronização com os docs-fonte:** 2026-08-18
> (base: **one-page do CEO de 2026-08-04** · `ARQUITETURA-ALVO.md` de 2026-08-18 · PRD v1.0 de
> 2026-05-25 com nota de escopo de 2026-08-18 · snapshot de status 2026-05-29 · auditoria 2026-06-08)

---

## 1. O que é a Plina

**Tokenizador institucional de direitos creditórios de consórcio brasileiro.** Cotas de
consórcio contempladas são adquiridas com deságio do cotista (cedente), agrupadas em um
veículo e representadas on-chain pelo token **PLINA-RF** na rede **Stellar**.

**Qual veículo depende da fase**, e isso governa o escopo de tudo (one-page do CEO, 2026-08-04):

| | Veículo | Financiamento | Quem detém PLINA-RF |
|---|---|---|---|
| **01 · MVP — é o alvo de mainnet hoje** | operação privada, Lei 11.795/2008 | equity dos sócios + seed | **só a Plina** |
| **02 · Oferta Privada** | FIDC sob CVM 175, com prestadores registrados | investidores qualificados | BR R$ 500k–10M · intl US$ 100k–5M |
| **03 · Oferta Pública** | idem, após track record e rating | varejo qualificado | via plataformas parceiras |

Decisão registrada em 2026-08-18, com alternativas recusadas e gatilhos de reversão, no
[Escopo da `ARQUITETURA-ALVO.md`](docs/ARQUITETURA-ALVO.md#decisão-de-escopo--quem-detém-plina-rf-na-fase-01).
**"Sem FIDC" não é "sem compliance"**: AML/COAF e LGPD valem desde a fase 01.

Enquadramento regulatório: **Lei 11.795/2008** (consórcios) na fase 01, **+ CVM 175** a partir
da fase 02. A Plina se posiciona como *tokenizadora institucional* (software white-label)
perante o BACEN/VASP — a
custódia fiat e o KYC operam sob anchors registradas. AML/COAF exige KYC nas duas pontas.
LGPD: PII **off-chain** (Brasil); on-chain só hash, endereços e timestamps.

### Tokens

| Papel | Asset code | Observação |
|---|---|---|
| Cota Sênior | `PLINARF` | rendimento preferencial. Renomeado para `PLINARFS` na reemissão do issuer em mainnet (M9) |
| Cota Subordinada | `PLINARFB` | *skin-in-the-game*, absorve a primeira perda |
| Ativo-ponte | `TESOURO` | Tesouro Direto tokenizado, entregue pelo anchor Etherfuse na entrada/saída de BRL via PIX |

O issuer é configurado com as flags nativas `AUTH_REQUIRED` (whitelisting por KYC),
`AUTH_REVOCABLE` (congelar) e `AUTH_CLAWBACK_ENABLED` (recuperar). Branding usa `PLINA-RF`;
on-chain o hífen não é permitido.

### Quatro superfícies, fricção assimétrica

| Rota | Público | Fricção | Sucesso |
|---|---|---|---|
| `/` + `/investir` | investidor institucional BR e internacional | alta (jargão, KYC institucional, roadshow) | alocação ≥ ticket mínimo |
| `/vender` | cotista contemplado que quer antecipar (persona Ricardo) | mínima (lead → oferta → PIX 48h) | cessão assinada |
| `/comprar` | comprador-usuário do bem (persona Maria, PJ) | mínima (calculadora → reserva 72h) | carta de crédito transferida |
| `/pool` | público / auditoria | nenhuma | NAV e composição verificáveis |

Complementos: `/minha-posicao` (saldo por classe, lido da chain), `/admin` (originação,
funil, liquidação, clawback), `/politica-clawback` (as 4 hipóteses formais).

---

## 2. Estágio atual

**POC funcional em testnet** (Stellar testnet + sandbox Etherfuse), demonstrável ponta a
ponta: login → KYC → escolha de classe → cotação → PIX → token na carteira, tudo auditável
on-chain. O caminho para mainnet está fatiado em **M0–M9**.

| Fase | Tema | Estado |
|---|---|---|
| M0 | Fundação/segurança | 🟡 Fase 1 entregue; falta Fireblocks concreto + admin→Clerk + WAF |
| M1 | Vender (cessão) | 🟡 funil completo; falta DocuSign real, PIX real, API das administradoras |
| M2 | Comprar | 🟡 calculadora/lead/reserva prontos; falta sinal PIX real e transferência |
| M3 | Investir BR | 🟡 fluxo completo + classes; falta termo FIDC (DocuSign) e UI de suitability |
| M4 | Investir internacional | 🔲 só o gate inerte |
| M5 | Ficha técnica PLINA-RF | 🟡 `/pool` com NAV; falta histórico, prospecto, janelas de liquidez |
| M6 | Compliance | 🔲 clawback e audit log prontos; falta screening OFAC/PEP e pareceres |
| M7 | Waterfall Soroban | 🔲 zero contratos `.rs`; cascata roda em Postgres hoje |
| M8 | Operação | 🟡 OTEL e rate-limit no ar; falta alertas e relatório mensal |
| M9 | Cutover mainnet | 🔲 preparado com kill-switch; na fase 01 depende de M0, M1, M2 e da parte de NAV do M5 — **não** de M3/M6 |

**O gargalo mudou de lugar com o faseamento (2026-08-18).** Constituir o FIDC, contratar
custodiante regulado, auditoria Big Four e rating são **fase 02** — deixaram de bloquear a
mainnet. O que trava a fase 01 é fechar **custódia de chaves, DocuSign, PSP de PIX e as APIs
das administradoras** (Embracon, Caixa, Bradesco, Porto, Itaú), mais os deltas técnicos
marcados `01` em [`ARQUITETURA-ALVO.md §13`](docs/ARQUITETURA-ALVO.md#13-do-estado-atual-ao-alvo).
O rail BRL do anchor **não é GA** e por isso ficou fora do caminho crítico da fase 01 — o motor
de originação (`/vender`, `/comprar`) roda por PIX off-chain, sem tocar no anchor.

**Schema vs. código:** as extensões do PRD já foram migradas
(`20260527054949_prd_v1_extensions`), mas a maioria dos modelos existe **só no schema, sem
consumidor** — preparação para M3/M5/M6/M7. `lib/integrations/{docusign,administradoras,fireblocks,psp}`
são apenas READMEs de interface, sem implementação concreta.

---

## 3. Stack

Next.js **16.2.4** (App Router) · React 19.2.4 · TypeScript strict · pnpm · Tailwind v4
*config-less* (tokens em `@theme` dentro de `app/globals.css`) · Prisma 6 + **Neon Postgres**
· `@stellar/stellar-sdk` 13 · **Privy** (auth + wallet embarcada) · **Etherfuse** (KYC hoje;
rampa BRL↔TESOURO ainda não é GA e está fora do caminho crítico da fase 01) · custódia de
chaves **em aberto entre três opções**, com guarda própria multisig assumida na fase 01 ·
**Vercel** (Fluid Compute, Blob, Edge Config, BotID, Analytics) · Upstash Redis (rate-limit)
· OpenTelemetry · Zod 4 · Vitest + Playwright.

> ⚠️ Esta versão do Next.js tem *breaking changes* frente ao conhecimento de treino dos
> modelos. Ler `node_modules/next/dist/docs/` antes de escrever código — é regra do
> `AGENTS.md`.

---

## 4. Invariantes de arquitetura

Coisas que **não** se reabrem sem decisão explícita:

- **"DB depois da chain".** O Postgres é cache/registro, não fonte da verdade. O estado
  canônico de saldos vive no Horizon. `/minha-posicao` e `/pool` leem da chain; gravações no
  banco só ocorrem **após** o sucesso on-chain.
- **Hexagonal-lite, com parcimônia.** Serviço nunca importa SDK de terceiro direto — a chamada
  concreta vive em `lib/integrations/<fornecedor>/`. Mas **porta genérica só nasce com o segundo
  consumidor real**. A `Anchor` está sendo partida em `Kyc` (porta, consumidor vivo na fase 01)
  e `Ramp` (integração concreta; vira porta só em M4) — a partição acontece dentro da migração
  do anchor. Ver `ARQUITETURA-ALVO.md` §7.1.
- **Signer fail-closed, enunciado por propriedade.** Em mainnet o sistema **recusa assinar se um
  único segredo de ambiente bastar para produzir assinatura válida**. Não é sobre fornecedor:
  vale para guarda própria com multisig, Fireblocks ou BitGo. ⚠️ Hoje `custodyConfigured()`
  (`lib/stellar/signer.ts:56`) ainda checa literalmente `FIREBLOCKS_*` — é dívida conhecida
  (§13, item 10). Exceção declarada: o **funder** assina com secret em env mesmo em mainnet.
- **Swap atômico.** TESOURO→PLINARF em uma transação de duas pernas; investidor assina via
  Privy, distributor assina server-side, backend combina e submete. Elimina slippage e estado
  "pela metade". O valor fica amarrado à cotação persistida server-side.
- **Trilha de auditoria on-chain.** Cada transição de estado grava `memo.hash` (SHA-256 do
  payload) via self-payment. `EventoAudit` é append-only.
- **Idempotência em todo write path.** `privyId @unique`, `Quote.submitXdrHash @unique`,
  `LiquidacaoSubmit.xdrHash @unique`, `WalletProvisioning`. Manter em qualquer rota nova.
- **Auth-guard obrigatório.** `withAuth` em todas as rotas `/api/investidor/**`, verificado
  por `scripts/lint/require-auth-guard.mjs` no `prebuild` — o build quebra na regressão.
- **Custódia assimétrica por papel.** Investidor: wallet Privy self-custody (sem seed
  phrase). Cedente e comprador: **sem wallet** — operam off-chain via PIX + DocuSign + carta
  de crédito na administradora. Fundo: **multisig nativo Stellar** — guarda própria na fase 01,
  custodiante a decidir na fase 02 contra a exigência do auditor do FIDC. Trocar é rotação de
  signatário via `setOptions`, não migração.
- **Clawback restrito.** Apenas as 4 hipóteses do whitepaper §6.5 (decisão judicial, sanção
  regulatória, fraude documental, erro operacional), modeladas no enum `MotivoClawback`.
  Nada de clawback discricionário. Exige dupla aprovação (jurídico + CTO) e é irreversível.
- **Etherfuse é decisão estratégica, não trocável no curto prazo.** A Plina segue com o
  fornecedor para ser **indicada por ele ao Build Award da SCF**. A porta isola o acoplamento
  técnico (e a `Anchor` está sendo partida em `Kyc` + `Ramp`), mas *trocar de fornecedor* não
  está em aberto — o motivo é comercial e vale mais que o atrito da migração. Ver
  `ARQUITETURA-ALVO.md` §2.3.
- **Stellar, não Ethereum.** Escolhida pelas flags regulatórias nativas, USDC/EURC da Circle
  e anchors SEP multi-jurisdição. Trade-off aceito: menos ecossistema DeFi. Lógica programável
  virá via Soroban (M7).

### Feature flags (`lib/env/flags.ts`, canônicas no Vercel Edge Config)

`MAINNET_ENABLED` (kill-switch do cutover — `mainnetCutoverGuard()` devolve 503) ·
`M3_INSTITUTIONAL_GATING` · `INTL_INVESTOR_FLOW` · `CUSTODY_PROVIDERS` · `SOROBAN_WATERFALL` ·
`BUYER_SELF_REALIZACAO` · `LAB_ENABLED` (rotas `/api/lab/*`, sempre 404 em mainnet). Todas
falham **fechado**; default `false`.

---

## 5. Não-objetivos declarados

- Varejo não é atacado nesta versão (é fase 03 do one-page, 2028).
- **Na fase 01, PLINA-RF não é distribuído a terceiro nenhum.** `/investir` fica gated por
  flag em mainnet até o FIDC existir. Reverte se o seed for estruturado como compra de token,
  ou se houver LOI que precise alocar antes — as duas são decisão do CEO.
- Sem liquidez secundária P2P entre holders de PLINA-RF — só janelas periódicas via resgate
  atômico.
- Sem clawback discricionário.

---

## 6. Pendências de negócio que travam código

- **`spread_curva_yield_pool`** (componente do deságio pago ao vendedor, em
  `lib/services/originacao.ts:gerarOferta`) depende do yield-alvo da classe Sênior, que
  **nunca foi fixado**. Números provisórios em `docs/2026-06-30-spread-cdi-provisorio.md`:
  Sênior BR `CDI + 5%` (faixa 4–7%), internacional `SOFR + 7%` (faixa 6–9%). Revisitar após
  o outreach institucional e a confirmação do CEO sobre o mix Sênior/Subordinada. **Não
  implementar antes disso.**
- **Termo do FIDC via DocuSign** (F-M3-7) bloqueado pela constituição formal do fundo.

---

## 7. Postura de segurança

Auditoria de 2026-06-08 (modo diário, gate 8/10): **sem vulnerabilidade crítica confirmada**.
Defesas em pé: auth-guard no `prebuild`, ownership check em todas as rotas que movem dinheiro,
comparação de senha em tempo constante, CSRF duplo (header + origin), rate-limit em rotas
públicas e no login admin, secrets só server-side, flags fail-closed, rotas de lab gated.

Achado aberto mais relevante: **[HIGH] CVE-2026-23870** em Next.js 16.2.4 (GHSA-8h8q-6873-q5fj),
RSC/Server Functions — o app usa App Router + Server Actions, portanto está na superfície.
Pede upgrade.

---

## 8. Design

`design-system/plina-design-system.md` é **autoritativo** sobre defaults visuais — cor,
tipografia, espaçamento, motion, componentes e voz. Rodar o self-check da §13 antes de
entregar UI. `design-system/tokens.json` é a fonte machine-readable;
`node design-system/check-contrast.mjs` valida os pares de cor. `DESIGN.md` é anterior ao
sistema e tem 3 erros de acessibilidade conhecidos (listados na §11) — onde divergirem, o
design system vence. Linguagem visual: "Regulated Terminal".

---

## 9. Onde está o quê

| Documento | Para quê |
|---|---|
| `docs/PRD-plina-v1.md` | plano completo, quadro de status por módulo, escopo e não-objetivos |
| `docs/DOCUMENTACAO-TECNICA.md` | referência única de engenharia: arquitetura, fluxos, integrações, trade-offs (estado atual) |
| `docs/ARQUITETURA-ALVO.md` | arquitetura de destino: stack, mapa completo de rotas, portas, painel admin, delta até lá |
| `docs/PLANO-MIGRACAO-ANCHOR.md` | migração do adaptador Etherfuse: modelo de org, KYC/KYB assíncrono, ponte USDC, fases |
| `docs/ACOMPANHAMENTO-CEO.md` | visão executiva em linguagem de negócio |
| `docs/DECISOES-CEO.md` | as 10 decisões que dependem do CEO, com opções, custo e recomendação |
| `docs/ESTUDO-CUSTODIA.md` | estudo de custódia |
| `docs/AUDITORIA-SEGURANCA-2026-06-08.md` + `docs/security-audit-*.md` | achados de segurança |
| `docs/M0-foundation-fase1.md` | decisões da fundação de segurança |
| `docs/2026-05-18-quote-binding-and-atomic-swap.md` | por que o swap é atômico e a cotação é amarrada |
| `docs/runbooks/` | cutover, pause-emissão, rotate-fireblocks, clawback, incident |
| `lib/anchors/README.md` | fonte de verdade dos 7 patches `PLINA-MOD-*` no SDK Etherfuse |
| `AGENTS.md` / `CLAUDE.md` | regras para agentes neste repo |

**Idioma:** documentação, commits e comunicação em **PT-BR**. Código e identificadores em
inglês onde já é a convenção do arquivo; nomes de domínio (`Cessao`, `Cota`, `Investidor`,
`RealizacaoCaminho`) permanecem em português.

**Papéis:** CEO Fabrício (sponsor) · CTO Thais (owner do PRD).
