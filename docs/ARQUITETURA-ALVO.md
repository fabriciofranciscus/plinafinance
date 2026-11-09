# Arquitetura-alvo — Plina

> **O que é este documento.** A arquitetura de destino: a stack que a Plina deve usar, o
> conjunto completo de rotas que o produto precisa ter, e os contratos transversais que
> toda rota nova deve respeitar. É o **alvo**, não o retrato — para o estado atual veja
> [`docs/DOCUMENTACAO-TECNICA.md`](./DOCUMENTACAO-TECNICA.md); para o plano por fase,
> [`docs/PRD-plina-v1.md`](./PRD-plina-v1.md).
>
> **Data:** 2026-09-12 (base de 2026-08-18) · **Owner:** CTO (Thais) · **Sponsor:** CEO (Fabrício)
> **Verificado contra o repo em:** 2026-09-11 (branch `chore/function-region-gru1`, commit `6cb17a4`)
>
> **Revisão de 2026-09-12 — camada on-chain.** Cinco achados novos entraram, todos verificados
> contra o código e, onde cabia, contra o ledger: o **preço de emissão sai de duas réguas
> diferentes** ([§8.2](#o-preço-de-emissão-também-vem-do-nav--e-hoje-vem-de-dois-lugares)), o
> **clawback nunca é verificado** e no Stellar ele é por trustline ([§8.1](#81-ativos-e-operações)),
> a **porta de assinatura é contornada em cinco call-sites** ([§7.1](#71-as-duas-portas-que-existem)),
> o **emissor do ativo-ponte opera com chave única** ([§8.1](#81-ativos-e-operações)), e o
> `memo.text` é truncado por caractere em vez de byte. `nav_oracle.rs` **sai do alvo**
> ([§8.1](#81-ativos-e-operações)). A fila da §13 e os testes da §11.4 foram atualizados.

## Escopo

O alvo é o **MVP em mainnet**, e desde 2026-08-18 isso quer dizer a **fase 01 do one-page**
— não o produto inteiro. O faseamento do material do CEO
([`One page - Plina Finance.pdf`](./One%20page%20-%20Plina%20Finance.pdf)) é a fonte da verdade
de escopo, e ele fatia o produto assim:

| | Veículo | Financiamento | Quem detém PLINA-RF |
|---|---|---|---|
| **01 · MVP** | operação privada, Lei 11.795/2008 | equity dos sócios + seed | **só a Plina** — ver decisão abaixo |
| **02 · Oferta Privada** | FIDC sob CVM 175, com prestadores registrados | investidores qualificados | BR R$ 500k–10M · intl US$ 100k–5M |
| **03 · Oferta Pública** | idem, após track record e rating | varejo qualificado | via plataformas parceiras |

As trilhas pós-cutover que já têm encaixe no código (M4 internacional, M7 Soroban) seguem no
alvo, agora explicitamente como fase 02. Fora do alvo, por decisão registrada no PRD §0:
varejo (fase 03), liquidez secundária P2P entre holders, e clawback discricionário.

**Vocabulário.** Onde este documento diz "o fundo", leia "o veículo" — sociedade na fase 01,
FIDC na fase 02. Onde diz **FIDC** ou **CVM 175** com todas as letras, é requisito de fase 02.

Legenda de status usada nas tabelas:

| | Significado |
|---|---|
| ✅ | existe e está alinhado ao alvo |
| 🔧 | existe, precisa de ajuste (descrito na coluna) |
| 🆕 | não existe, precisa ser criado |
| ⛔ | existe e deve sair |

### Decisão de escopo — quem detém PLINA-RF na fase 01

**Decidido em 2026-08-18 (CTO, sobre o one-page do CEO): ninguém além da Plina.** O token é
emitido em mainnet como registro auditável do pool próprio, comprado com caixa da empresa;
`/investir` fica gated por flag até a fase 02.

O argumento que decide é **reversibilidade**. A política de clawback tem quatro hipóteses
fechadas (§8.1), e *"distribuímos sob o regime errado"* não é nenhuma delas — se um terceiro
receber PLINA-RF na fase 01 e o enquadramento se mostrar equivocado, não existe caminho
on-chain de volta. Ligar a distribuição depois é uma flag; recolher um token emitido não é.

| Alternativa | O que era | Por que não |
|---|---|---|
| **B · círculo restrito** | sócios e seed detêm PLINA-RF sob termo privado de cessão, sem termo de adesão a FIDC | põe token de terceiro em mainnet antes de existir veículo que o legitime, com o problema de reversibilidade acima. Continua sendo a opção certa **se** o seed for estruturado como compra de token |
| **C · qualificados de fato** | distribuição na fase 01 sob regime de dispensa de registro; a fase 02 passaria a diferir só pela existência do FIDC | mesmo risco de B, com superfície maior: exige parecer jurídico sobre a dispensa antes do cutover e mantém M3 inteiro — suitability CVM 30 e ticket check — no caminho crítico de mainnet |

Razões de apoio, nenhuma delas decisiva sozinha:

- **Tira o fornecedor do caminho crítico.** O rail BRL do anchor não é GA (§2.3), e todo o
  caminho BRL → ativo-ponte → PLINARF depende dele. O motor de receita da fase 01 —
  `/vender` e `/comprar`, com PIX via PSP, DocuSign e administradora — não passa pelo anchor
  em nenhuma perna. A fase 01 vai a mainnet sem depender de uma data de GA que não é nossa.
- **O registro on-chain é o entregável.** A fase 03 do one-page exige track record e rating,
  e isso não se produz retroativamente. Emitir com capital próprio e ninguém do outro lado é
  o que torna a fase 01 valiosa apesar de não distribuir nada.

**O que custa.** `/investir` fica pronto e desligado — M3 está quase inteiro, e é flag, não
deleção. E a originação passa a ser limitada ao caixa próprio: se o ciclo de realização for
mais lento que o previsto, a fase 01 trava por capital, não por engenharia.

**O que reverte esta decisão** — qualquer um dos dois basta, e a chamada é do CEO:

1. o seed ser estruturado como **compra de token**, e não como equity na Plina → força a opção B;
2. **LOI institucional que precise alocar** antes da constituição do FIDC → opção B, com parecer
   jurídico sobre o instrumento **antes** da primeira emissão a terceiro, não depois.

> **"Sem FIDC" não é "sem compliance".** AML/COAF e LGPD não dependem do veículo: KYC nas duas
> pontas, trilha de auditoria, `operadorId` nomeado e o ciclo de vida do dado pessoal são
> requisito de fase 01. O que a fase 02 acrescenta são os prestadores registrados e a moldura
> da CVM 175 — não a obrigação de se comportar.

---

## 1. Princípios invariantes

Os seis primeiros já são doutrina do projeto e **não se reabrem**. Os três últimos são
novos: nascem de gaps verificados no código em 2026-08-18 e passam a ter o mesmo peso.

1. **DB depois da chain.** Horizon é a fonte da verdade de saldos; o Postgres é
   cache/registro. Gravação em banco só após sucesso on-chain.
2. **Hexagonal-lite, com parcimônia.** Serviço nunca importa SDK de terceiro direto — a
   chamada concreta vive em `lib/integrations/<fornecedor>/`. Mas **porta genérica só nasce
   com o segundo consumidor real** (§7.2). Abstrair antes disso produz interface errada.
3. **Fail-closed.** Flag ausente = desligada. Guard ausente = build quebra. E mainnet
   **recusa assinar quando o material de assinatura é uma chave única vinda de env** — o
   invariante é essa propriedade, não um fornecedor (§10.1).
4. **PII off-chain.** On-chain só hash, endereço e timestamp. LGPD não é negociável.
5. **Idempotência em todo write path.** Chave única explícita por operação.
6. **Toda transição de estado grava `EventoAudit`** com `payloadHash` ancorado on-chain
   via `memo.hash`.
7. **Todo ato administrativo é atribuível a uma pessoa.** `EventoAudit.operadorId` vem do
   contexto de autenticação — nunca de uma constante nem de argumento que o handler pode
   esquecer. Auditoria que não atribui ato a pessoa não serve nem à operação privada da
   fase 01 nem ao FIDC da fase 02 — e é o registro da fase 01 que a fase 02 vai auditar.
8. **O kill-switch cobre todo movimento de valor, por construção.** O guard de cutover é
   aplicado num **choke point** com lint bloqueante (§6.7), não chamada a chamada. Pausar a
   emissão tem de pausar de fato — e continuar pausando depois do próximo PR.
9. **Paridade entrada/saída.** Todo caminho de entrada tem caminho de saída simétrico,
   alcançável pela navegação. Fluxo de saída inacessível conta como fluxo inexistente.

---

## 2. Stack-alvo

### 2.1 Núcleo — decidido, não reabrir

| Camada | Tecnologia | Nota |
|---|---|---|
| Framework | **Next.js 16** (App Router) + React 19 | SSR nas páginas indexáveis, CSR nos wizards. Ler `node_modules/next/dist/docs/` antes de codar |
| Linguagem | **TypeScript** strict | |
| Pacotes | **pnpm** | |
| Estilo | **Tailwind v4** config-less | tokens em `@theme` no `app/globals.css` |
| Design | **`design-system/plina-design-system.md`** | autoritativo sobre UI; self-check §13 obrigatório |
| ORM/DB | **Prisma 6 + Neon Postgres** | `DATABASE_URL` pooled, `DIRECT_URL` para migrations |
| Blockchain | **Stellar** (`@stellar/stellar-sdk` 13) | flags regulatórias nativas; Soroban em M7 |
| Auth investidor | **Privy** | wallet embarcada, assinatura raw-hash Ed25519 |
| Plataforma | **Vercel** — Fluid Compute, Node 24, região **`gru1`** | `gru1` co-loca function e Postgres em São Paulo; PII de KYC não sai do país |
| Storage | **Vercel Blob** privado | prospecto, contratos, comprovantes |
| Flags | **Vercel Edge Config** | canônico em prod, `process.env` como fallback |
| Rate-limit | **Upstash Redis** | serverless não tem memória compartilhada |
| Observabilidade | **OpenTelemetry** | exportador trocável |
| Validação | **Zod 4** | `.strict()` em todo body |
| Testes | **Vitest** + **Playwright** | |

### 2.2 A contratar — arquitetura pronta, fornecedor pendente

| Função | Alvo | Onde vive no código | Bloqueio |
|---|---|---|---|
| Custódia issuer/distributor | **fase 01: guarda própria com multisig nativo Stellar** · fase 02: decidir custodiante contra a exigência real do auditor do FIDC | `lib/stellar/signer.ts` | nenhum bloqueio na fase 01. Três opções em aberto para a fase 02 — ver [§14.3](#14-decisões-pendentes), [`DECISOES-CEO.md` §2](./DECISOES-CEO.md) e [`ESTUDO-CUSTODIA.md`](./ESTUDO-CUSTODIA.md) |
| Auth admin | **Clerk** (ou Auth.js) com usuários nomeados + RBAC | `lib/auth/admin.ts` | nenhum técnico — é o item que destrava o princípio 7 |
| Assinatura | **DocuSign** empresarial + e-CPF | `lib/integrations/docusign/` | contrato |
| PIX | **PSP** (Stark, BTG ou similar) | `lib/integrations/psp/` | contrato |
| Cessão B2B | **APIs das administradoras** (Embracon, Caixa, Bradesco, Porto, Itaú) | `lib/integrations/administradoras/` | acordo comercial; fallback cartório digital |
| Screening | **OFAC/UE/ONU + PEP BR** | `lib/integrations/screening/` 🆕 | fornecedor a definir |
| Rating / auditoria / custodiante | Big Four, agência, custodiante CVM | — | comercial (M6) |

### 2.3 Anchor — Etherfuse

**Decidido: manter o Etherfuse — e o motivo é estratégico, não técnico.** A Plina segue com o
fornecedor para ser **indicada por ele ao Build Award da SCF** (Stellar Community Fund).

Isso precisa estar escrito com essas palavras, porque a leitura técnica isolada é fraca —
endpoints removidos, sunset vencido, API proprietária que não é SEP (abaixo), rail BRL ainda
não-GA — e quem ler só os custos daqui a seis meses conclui que a decisão foi erro, ou
"otimiza" a dependência para fora. **Decisão sem motivo registrado é decisão que o próximo
reverte.** O motivo opera noutro eixo, e é bom: a indicação vale mais que o atrito da migração.

**O que isso não muda.** O rail BRL continua fora do caminho crítico da fase 01 (Escopo): a
originação roda por PIX off-chain e não toca o fornecedor. Essa separação fica **mais** valiosa
com a decisão estratégica, não menos — ela permite manter a relação sem que a relação defina a
data de mainnet. Manter o fornecedor e depender do fornecedor são coisas diferentes.

**O que isso muda.** A integração quebrada deixa de ser só dívida técnica. Se o fornecedor é
quem indica, o estado da integração é o cartão de visitas com ele — e hoje ela chama três
endpoints removidos e opera depois de um sunset vencido. O item 1 da §13 ganhou um **prazo
comercial** que não tinha.

**A tensão a nomear antes que alguém note.** A fase 01 não exercita o rail BRL em mainnet. Se a
narrativa da indicação for "construído em Stellar sobre os trilhos do Etherfuse", a resposta
pronta é: o **KYC de pessoa física é integração viva na fase 01**, e o caminho completo
BRL → ativo-ponte → PLINARF é demonstrável ponta a ponta em **testnet**. A narrativa se sustenta
— como argumento consciente, não como descoberta em conversa.

A porta segue isolando o fornecedor (§7.1), mas o adaptador atual (SDK vendorizado com 7 patches
`PLINA-MOD-*`) está **quebrado**: usa endpoints cujo sunset foi **16/08/2026** e três que já
foram removidos.

> ⚠️ **O rail BRL ainda não é GA.** A documentação do fornecedor lista **Brasil (BRL) como
> "Upcoming"** — o único mercado live é o México (MXN). O fornecedor está construindo uma
> ramp **USDC↔BRL**; a Plina segue com TESOURO como ponte (§8.1), tratando o símbolo como
> configuração para não depender de qual dos dois vence. Data de GA e pricing para BR
> precisam ser confirmados por escrito antes de qualquer compromisso de mainnet. Plano de
> execução em [`PLANO-MIGRACAO-ANCHOR.md`](./PLANO-MIGRACAO-ANCHOR.md).

| Endpoint usado hoje | Situação na API do fornecedor | Alvo |
|---|---|---|
| `POST /ramp/agreements/electronic-signature` | **removido** | assinatura acontece dentro do launch `/idv` |
| `POST /ramp/agreements/terms-and-conditions` | **removido** | idem |
| `POST /ramp/agreements/customer-agreement` | **removido** | idem |
| `POST /ramp/onboarding-url` | sunset 16/08/2026 | criar org + launch `/idv` |
| `POST /ramp/customer/{id}/kyc` | sunset 16/08/2026 | `POST /ramp/customer/{id}/verification` |
| `POST /ramp/customer/{id}/kyc/documents` | deprecado, sem data | `POST .../verification/documents` (multipart real, ordem explícita, resposta 202) |
| `GET /ramp/customer/{id}/kyc` | **não deprecado** | manter |
| `POST /ramp/bank-account` | ativo | validar contra `POST /ramp/customer/{id}/bank-account`, que é o caminho documentado |

Consequências para a arquitetura, além do conserto de chamadas:

- **KYC deixa de ser síncrono.** Toda submissão responde `202` (aceito, sendo aplicado) e o
  estado chega por **webhook** (`kyc_updated`, `kyb_updated`). O produto precisa de rota de
  webhook, estado intermediário persistido e UI de espera — ver `/api/webhooks/anchor` na §4.
- **Verificação é organization-level**, não per-wallet: `Wallet.kycStatus` saiu das respostas.
  O "customer" passa a ser uma **organização `personal` cujo `id` nós geramos** — esse UUID
  é o `customer_id` em todo o resto da API.
- **Sempre há um passo hospedado.** Três requisitos só podem ser cumpridos pelo cliente
  dentro do widget `/idv`, sem API equivalente: **confirmação de e-mail, selfie de liveness
  e aceite do customer agreement**. O que se escolhe não é "hosted ou API", e sim **quanto
  se pré-preenche por API antes do launch**.

#### KYC (PF) vs KYB (PJ) — são produtos diferentes

| | Cedente / comprador (PF) | Investidor institucional (PJ) |
|---|---|---|
| Organização | `personal` | `business` |
| Verificação | **KYC** — dados pessoais, documento de identidade, ocupação, comprovante de endereço, selfie, agreement | **KYB** — contrato social, registro, certidões, estrutura societária, UBOs, procuração, demonstrações financeiras, origem de recursos, carta de informações corporativas |
| Superfície | `/verification/*` + launch `/idv` (`scope: verification`) | launch `/kyb` (`scope: kyb`, `?org=<id>`) — **sem caminho programático** |
| Webhook | `kyc_updated` | `kyb_updated` |
| Quem mais é verificado | ninguém | cada UBO e representante legal faz o **KYC próprio**; empresas-mãe recursivamente |

O patch `PLINA-MOD-001` fixa `accountType: 'business'` para todo mundo. No alvo isso vira
condicional pelo papel: cedente e comprador são `personal`; investidor institucional é
`business` e passa por KYB — um processo muito mais pesado, que precisa aparecer no
roadshow como prazo, não como formulário.

#### Recomendação de fluxo

Um só desenho, nos dois funis: **pré-preencher por API tudo o que a Plina já coleta, e
lançar `/idv` só para o que sobra.** Os passos ficam:

```
1. POST /ramp/organization        cria a org personal (id gerado por nós, userInfo.email obrigatório)
2. POST .../verification          dados pessoais → 202
   ⤷ aguardar webhook kyc_updated (roteamento por país é assíncrono; enviar antes dá 409)
3. GET  .../kyc?requirements=true lê o que ainda falta
4. POST .../verification/documents   multipart real (não base64) — só o que veio pending
5. POST .../verification/questionnaire  ocupação (o código de `industry` vem de
                                        GET /ramp/verification/occupations)
6. launch /idv                    e-mail + selfie + agreement (requiresLaunch: true)
7. webhook kyc_updated → approved
```

Isso preserva o wizard sob o design system (a Plina já coleta nome, CPF e documentos desde
o commit `029c41c`), evita pedir a mesma coisa duas vezes e ainda assim termina no widget —
que é obrigatório. Para PJ, o passo 6 vira o launch `/kyb`.

> **Ponto de atenção:** os dados pessoais são cruzados com o documento enviado. Endereço,
> nome ou data de nascimento divergentes travam o cliente em revisão manual em vez de
> aprovar. O `202` nunca é prova de que o requisito foi satisfeito.

**O contrato é vendor-shaped, e isso está declarado de propósito.** Organização
`personal`/`business`, launch `/idv`, launch `/kyb`, webhooks `kyc_updated` — nenhum desses
conceitos tem equivalente em SEP-12, SEP-24 ou SEP-38, que é como MoneyGram e Settle falam
(PRD §2.4). A consequência a escrever agora, em vez de descobrir em M4: **um anchor SEP não vai
encaixar como adaptador — vai forçar re-derivar o contrato de `Ramp`** quando a segunda
implementação real chegar. É o argumento da §7.2 aplicado a este fornecedor, e é por isso que a
§7.1 devolve `Ramp` para integração concreta até lá. O SEP-1 (`stellar.toml`, §4.1) é outro
assunto e segue correto.

### 2.4 Multi-anchor (M4 — fase 02)

A rampa passa a resolver por jurisdição: BR (fornecedor atual, PIX), US (MoneyGram), EU
(Settle). Seleção via `CUSTODY_PROVIDERS`/`INTL_INVESTOR_FLOW` e `Investidor.jurisdicao`.

**É aqui que a porta `Ramp` nasce**, e não antes (§7.1): é o momento em que existe a segunda
implementação real. Contar com re-derivar o contrato nesse ponto é o plano, não o acidente —
os fornecedores regionais falam SEP e o atual não (§2.3). O `Kyc`, esse já é porta na fase 01,
e em M4 ganha os provedores regionais como segundo adaptador.

---

## 3. Topologia

```
                    ┌──────────────────────────────────┐
   proxy.ts ───────▶│  Vercel · Next 16 · Fluid · gru1 │
   (i18n, locale)   │  App Router · Server Actions     │
                    └──┬─────────┬─────────┬───────────┘
                       │         │         │
        ┌──────────────┘         │         └──────────────┐
        ▼                        ▼                        ▼
  ┌───────────┐        ┌──────────────────┐      ┌────────────────┐
  │   Neon    │        │  Portas (lib/)   │      │  Stellar       │
  │ Postgres  │        │  Kyc             │      │  Horizon       │
  │ (cache +  │        │  StellarSigner   │─────▶│  + Soroban(M7) │
  │  trilha)  │        │  Signature       │      └────────────────┘
  └───────────┘        │  Payments        │
                       │  Administradora  │      ┌────────────────┐
  ┌───────────┐        │  Screening       │◀────▶│  Fornecedores  │
  │  Upstash  │        └──────────────────┘      │  externos      │
  │  (rate)   │                 ▲                └────────────────┘
  └───────────┘                 │                        │
                                └── webhooks ────────────┘
```

Regra de dependência: `app/` → `lib/services/` → portas. Nunca `app/` → adaptador concreto.

### Estrutura de módulos

```
lib/
  services/      regras de negócio (pessoa, investidor, originacao, realizacao,
                 tokenizacao, liquidacao, pool, holdings, cessao-comprador,
                 nav 🆕, screening 🆕, janela-liquidez 🆕)
  anchors/       porta `Kyc` + adaptadores (§7.1). A rampa sai daqui e volta a ser
                 integração concreta em `integrations/` até M4
  stellar/       Horizon, XDR, signer, audit, fee, classes
  integrations/  docusign · psp · administradoras · fireblocks · screening 🆕
  auth/          admin (Clerk 🔧) + RBAC 🆕 + CSRF
  wallet/        auth-guard (investidor) · pessoa-auth (multi-papel)
  api/           envelope, erros, with-api
  env/           flags, feature-gates, lab
  audit/ email/ comprovante/ rate-limit/ observability/ format/ http/ i18n/
```

---

## 4. Mapa de rotas

### 4.1 Páginas públicas

| Rota | Público | Status | Nota |
|---|---|---|---|
| `/` | investidor institucional | ✅ | i18n pt-BR/EN via `proxy.ts` |
| `/pool` | qualquer um, auditoria | 🔧 | falta histórico de NAV e link para eventos |
| `/pool/eventos` | auditoria | 🆕 | eventos on-chain do fundo, links Stellar Expert (M5) |
| `/cotas`, `/cotas/[id]` | comprador | ✅ | vitrine + diligência |
| `/politica-clawback` | qualquer um | ✅ | as 4 hipóteses |
| `/compliance` | investidor, regulador | 🆕 | prestadores nominais, CVM 175, pareceres (M6) — **fase 02** |
| `/lgpd` | qualquer um | 🆕 | política de dados, DPO e canal de pedido do titular — arquitetura em [§9.8](#98-ciclo-de-vida-do-dado-pessoal) (M6) |
| `/prospecto` | investidor | 🆕 | ficha técnica + PDF no Blob (M5) |
| `/.well-known/stellar.toml` | SEP-1 | ✅ | único CORS `*` do sistema, correto |

### 4.2 Funil de baixa fricção

| Rota | Status | Nota |
|---|---|---|
| `/vender` | ✅ | wizard do cedente |
| `/vender/lead` | ✅ | |
| `/vender/acompanhar/[leadId]` | ✅ | `leadId` é token opaco, sem auth por design |
| `/comprar` | ✅ | calculadora + funil |
| `/comprar/lead` | ✅ | |
| `/comprar/reservar` | 🔧 | consolidar com `/comprar/reserva` — hoje são duas rotas quase idênticas |
| `/comprar/[reservaId]/comprovante` | ✅ | |
| `/cessao/[id]/comprovante` | ✅ | |

### 4.3 Área autenticada

| Rota | Status | Nota |
|---|---|---|
| `/entrar` | ✅ | login dedicado, roteia por `?next=` |
| `/painel` | 🔧 | hub pós-login role-aware; **precisa expor o caminho de saída** |
| `/investir` | 🔧 | wizard completo; falta UI de suitability e seletor de jurisdição (M4) |
| `/minha-posicao` | 🔧 | 987 linhas com o resgate embutido; extrair o resgate para `/sacar` |
| `/sacar` | 🔧 | **órfã** — nenhuma navegação leva a ela. Vira o caminho único de saída |
| `/lab` | 🔧 | página sem gate; aplicar `isLabEnabled()` como já é feito nas APIs |

**Decisão de arquitetura — caminho de saída único.** Hoje existem duas metades
desconectadas: `/minha-posicao` liquida PLINARF contra o distributor pagando *BRL fictício*
(`lib/services/liquidacao.ts:7`), e `/sacar` faz o off-ramp real TESOURO→BRL via PIX sem
estar linkada. O alvo é um fluxo só, espelho da entrada:

```
entrada:  BRL ──PIX──▶ TESOURO ──swap atômico──▶ PLINARF
saída:    PLINARF ──resgate──▶ TESOURO ──off-ramp PIX──▶ BRL
```

`/minha-posicao` mostra posição e abre `/sacar`; `/sacar` conduz as duas pernas em um
wizard, respeitando `JanelaLiquidez` quando a janela existir (M5).

### 4.4 Painel administrativo

O painel tem superfície, identidade e fluxo de aprovação próprios, então vive inteiro na
**[§5](#5-painel-administrativo)** — páginas, Server Actions e as rotas de API que sobram.
Descrever metade dele aqui e metade lá é como as duas versões divergem.

### 4.5 API — investidor

Sob `withAuth`/`requireInvestidor`, salvo onde a tabela indicar — `onboard` é a única
exceção, e é pública por construção: é ela que cria o `Investidor` que as demais exigem.
🛡 **classifica** a rota como movimentadora de valor — não é instrução para adicionar chamada
manual. Ver [§6.7](#67-o-guard-de-cutover-é-um-choke-point).

| Rota | Status | Nota |
|---|---|---|
| `POST /api/investidor/onboard` | ✅ | pública por design; valida token Privy no handler |
| `POST /api/investidor/quote` | ✅ 🛡 | aplica ticket **mínimo** (`ticketMinimoFor`, `lib/config/suitability.ts:34`). O **teto** e o limite de concentração por cotista são fase 02 e ainda não existem em código (§9.3) |
| `POST /api/investidor/suitability` | ✅ | CVM 30 |
| `POST /api/investidor/entidade` | ✅ | |
| `POST /api/investidor/bank-account/register` | 🔧 | migrar para o endpoint per-customer do anchor |
| `GET /api/investidor/events` | ✅ | strip de chaves `_` |
| `.../buy/trust-bridge/{build,submit}` | 🔧 🛡 | renomeada de `trust-tesouro`; ativo por configuração |
| `.../buy/trust-plinarf/{build,submit}` | ✅ 🛡 | |
| `.../buy/onramp/create` | ✅ 🛡 | |
| `.../buy/onramp/status` | ✅ | passará a ser complementado por webhook |
| `.../buy/onramp/sandbox-pay` | ✅ | 403 fora de sandbox |
| `.../buy/claim/{build,submit}` | 🔧 🛡 | renovar XDR expirado antes de submeter |
| `.../buy/swap/build` | ✅ 🛡 | |
| `.../buy/swap/submit` | ✅ 🛡 | **é a emissão de fato** — hoje fora do guard; o choke point resolve |
| `.../buy/offramp/{create,status,signing-tx,submit}` | 🔧 🛡 | pré-check de carteira antes de criar a ordem |
| `.../liquidar/{quote,build,submit}` | 🔧 🛡 | pagamento hoje é BRL fictício — ver §4.3 |
| `GET /api/investidor/kyc/status` | 🆕 | estado do KYC assíncrono (pós-webhook) |

### 4.6 API — conta, vender, comprar

| Rota | Auth | Status |
|---|---|---|
| `GET /api/conta/me` | Pessoa | ✅ |
| `POST /api/conta/kyc` | Pessoa | 🔧 migrar para `/verification` + assíncrono |
| `POST /api/vender/simular` | público | ✅ |
| `POST /api/vender/lead` | Pessoa + KYC | ✅ |
| `POST /api/vender/aceitar-oferta` | Pessoa + KYC | ✅ |
| `GET /api/comprar/cotas` | Pessoa | ✅ |
| `GET /api/comprar/cota/[id]/diligencia` | Pessoa | ✅ |
| `POST /api/comprar/lead` | público | ✅ BotID + rate-limit |
| `POST /api/comprar/reserva` | Pessoa | ✅ |
| `POST /api/comprar/reservar` | Pessoa | ⛔ duplicata de `/reserva` |
| `POST /api/comprar/kyc` | Pessoa | 🔧 idem `/conta/kyc` |
| `POST /api/comprar/cessao` | Pessoa + KYC + ownership | ✅ |
| `POST /api/comprar/confirmar` | Pessoa + KYC + ownership | ✅ 🛡 |

### 4.7 API — admin

Ver **[§5.2](#52-superfície-única-de-mutação)**. Resumo: mutação de painel é Server Action;
sobram três rotas de API, todas com consumidor externo ao painel.

### 4.8 API — webhooks, crons e plataforma

Faltam por inteiro hoje. São pré-requisito de mainnet: sem eles, o sistema depende de
polling para estado que os fornecedores entregam por push, e não há fechamento diário.

| Rota | Status | Nota |
|---|---|---|
| `POST /api/webhooks/anchor` | 🆕 | `kyc_updated`, `kyb_updated`, ordens. Verificação de assinatura obrigatória |
| `POST /api/webhooks/docusign` | 🆕 | envelope assinado → `Cessao.ASSINADA` + hash on-chain |
| `POST /api/webhooks/psp` | 🆕 | confirmação de PIX (entrada e saída) |
| `POST /api/cron/nav-snapshot` | 🆕 | 18:00 BRT, grava `NavSnapshot` e ancora o hash (M5) |
| `POST /api/cron/reservas-expiradas` | 🆕 | expira reservas de 72h |
| `POST /api/cron/estoque-status` | 🆕 | recalcula VERDE/AMARELO/VERMELHO/BAIXA |
| `POST /api/cron/screening-recheck` | 🆕 | re-screening trimestral |
| `POST /api/cron/fechamento-mensal` | 🆕 | fechamento contábil do mês — posição, caixa e taxa apropriada, a partir de `MovimentoFundo` + `NavSnapshot` (§8.2). **Fase 01**, porque alimenta o track record e a contabilidade. O relatório ao investidor que se apoia nele é fase 02 |
| `GET /api/pool/summary` | 🔧 | aplicar `publicLimiter` |
| `GET /api/pool/nav/historico` | 🆕 | série do `NavSnapshot` (M5) |
| `GET /api/health` | 🆕 | liveness para status page |
| `/api/lab/*` | ✅ | gated por `LAB_ENABLED`, 404 em mainnet |

Crons autenticados por `CRON_SECRET` (header), nunca acessíveis publicamente.

---

## 5. Painel administrativo

O painel não é acessório: o modelo de negócio é operado à mão — originar cota, conduzir
funil, liquidar, executar clawback. Ele é a interface do veículo, e é onde a operação encosta
no dinheiro. Esta seção é a **única** descrição dele: páginas, superfície de mutação,
identidade e o fluxo de aprovação.

Hoje é uma página única de 598 linhas com seis seções, autenticada por senha compartilhada.

### 5.1 Páginas

Route group com layout próprio, navegação lateral e visibilidade por papel.

| Rota | Status | Conteúdo | Papel mínimo |
|---|---|---|---|
| `/admin` | 🔧 | dashboard: NAV, tokens vivos, caixa, concentração, alertas | `LEITURA` |
| `/admin/originacao` | 🔧 | incorporar cota, validação legal, estoque | `OPERADOR` |
| `/admin/vendedores` | 🔧 | pipeline do cedente (oferta → cessão → PIX → incorporação) | `OPERADOR` |
| `/admin/compradores` | 🔧 | pipeline do comprador (reserva → cessão → realização) | `OPERADOR` |
| `/admin/investidores` | 🔧 | posições, trustlines, suitability, revogação | `OPERADOR` |
| `/admin/clawback` | 🔧 | solicitação e aprovação (§5.4) — hoje é um form de um clique | `OPERADOR` solicita · `APROVADOR` aprova |
| `/admin/compliance` | 🆕 | screening OFAC/PEP, prestadores regulados, alertas (M6) | `OPERADOR` |
| `/admin/ops` | 🆕 | saúde das integrações, saldos, crons, incidentes — **e as ações de reparo da [§6.8](#68-operações-de-várias-pernas-e-recuperação)** | `LEITURA` para ver · `OPERADOR` para reparar |
| `/admin/leads` | 🆕 | leads EOI da waitlist + export CSV — hoje o endpoint existe sem UI | `LEITURA` |
| `/admin/audit` | 🔧 | trilha filtrável por operador, ação, período | `LEITURA` |

O painel é **pt-BR fixo** (§12.2).

### 5.2 Superfície única de mutação

Hoje convivem Server Actions (`ensureAuth()`, só cookie) e rotas API (`isAdminAuthenticated`
+ `requireAdminCsrf`) mutando o mesmo domínio com contratos de segurança diferentes. E as
duas rotas API são multiplexadores por string `action`, o que destoa do resto do código.

**Regra:** mutação disparada por form do painel é **Server Action**. Rota de API existe
apenas onde o consumidor não é o próprio painel. Um caminho, um guard.

Todas as actions com `requireAdmin(papel)`, `operadorId` vindo do contexto de autenticação
(§6.7) e `revalidatePath` do que foi afetado. 🛡 marca a action que move valor: ela declara
classificação de cutover como qualquer rota, e o lint da [§6.7](#67-o-guard-de-cutover-é-um-choke-point)
varre este arquivo junto com `app/api/**`. A proteção CSRF nativa do Next 16 para Server
Actions substitui o header `x-plina-admin` manual.

| Server Action | Status | Substitui |
|---|---|---|
| `incorporarCotaAction` · `atualizarStatusCotaAction` | 🔧 | `originacao`: `incorporar-cota`, status |
| `registrarValidacaoLegalAction` | ✅ | laudo + hash on-chain |
| `gerarOfertaAction` · `registrarCessaoAction` · `executarPagamentoAction` 🛡 | 🔧 | `originacao`: as três actions restantes; em mainnet o pagamento chama a integração de PIX |
| `cancelarReservaAction` · `executarRealizacaoAction` 🛡 | 🔧 | `realizacao` |
| `solicitarClawbackAction` · `aprovarClawbackAction` | 🆕 | fluxo da §5.4 |
| `repararOperacaoAction` 🛡 | 🆕 | retoma a perna travada de uma saga (§6.8); grava estado de origem no `EventoAudit` |
| `revisarScreeningAction` | 🆕 | M6 |

| Rota de API | Status | Consumidor |
|---|---|---|
| `GET /api/admin/leads-eoi` | ✅ | download de CSV pelo browser |
| `GET /api/admin/ops/health` | 🆕 | monitoração externa / status page |
| `POST /api/admin/logout` | ✅ | form de logout |

### 5.3 Identidade e RBAC

Senha única compartilhada sai. Entram usuários nomeados (Clerk) e **três papéis**:

| Papel | Pode |
|---|---|
| `OPERADOR` | originar cota, conduzir funis, registrar cessão e pagamento, revisar screening, **solicitar** clawback |
| `APROVADOR` | tudo do operador, mais **aprovar clawback** (§5.4) |
| `LEITURA` | dashboards e trilha, sem mutação |

Todo handler recebe a identidade e propaga para `EventoAudit.operadorId`. A constante
`'admin-panel'`, hoje presente em nove pontos de mutação, deixa de existir.

> **Por que três e não cinco.** O requisito real é **segregação de funções no clawback** —
> duas pessoas distintas assinando um ato irreversível. Isso se satisfaz com `APROVADOR`.
> Papéis funcionais (`COMPLIANCE`, `JURIDICO`, `CTO`) descrevem cargos que hoje são a mesma
> pessoa; modelar cargo antes de existir gente para ocupá-lo produz um modelo de permissão
> caro de migrar quando errado, e fácil de expandir quando o time crescer. A qualificação
> do aprovador (jurídico ou CTO) é política registrada em `AprovacaoClawback.papel` e
> conferida no runbook, não gate de código.

### 5.4 Dupla aprovação de clawback

Os docs e o `runbooks/clawback.md` afirmam que existe; o código não tem nada disso. O alvo:

```
solicitar ──▶ PENDENTE_APROVACAO ──▶ aprovada por 2 pessoas distintas
   │            (motivo + fundamentoUrl        dois `APROVADOR` distintos;
   │             + hash do documento)           solicitante não pode aprovar)
   │                                                    │
   └─ expira em 72h sem 2ª aprovação                    ▼
                                          executa on-chain · irreversível
                                          EventoAudit.CLAWBACK_EXECUTADO
                                          com os dois aprovadores nomeados
```

Modelo novo `SolicitacaoClawback` (motivo do enum `MotivoClawback`, fundamento, solicitante,
aprovadores, status). O solicitante **não pode** ser um dos aprovadores.

---

## 6. Contratos transversais

### 6.1 Matriz de autenticação

| Mecanismo | Escopo | Implementação |
|---|---|---|
| `withAuth` / `requireInvestidor` | `/api/investidor/**` | Bearer Privy → `Investidor` |
| `withPessoaAuth` / `requirePessoa` | conta, vender, comprar | Bearer Privy → `Pessoa` multi-papel |
| `requireAdmin(papel)` 🆕 | `/admin/**`, `/api/admin/**` | sessão Clerk + papel + CSRF |
| `verifyWebhookSignature(fornecedor)` 🆕 | `/api/webhooks/**` | HMAC do fornecedor; rejeita sem assinatura válida |
| `requireCronSecret` 🆕 | `/api/cron/**` | header secreto |
| público | 5 rotas, allowlist explícita | `scripts/lint/require-auth-guard.mjs` |

O lint de pré-build já cobre **todo** `app/api/**` com allowlist justificada — mantê-lo
assim, estendê-lo aos novos marcadores (`requireAdmin`, webhook, cron) e às Server Actions do
painel, que hoje ficam fora da varredura (§6.7).

### 6.2 Envelope e erros

`{ data, error: null }` / `{ data: null, error: { code, message, requestId } }`, header
`x-request-id` em toda resposta, cliente discrimina por `error.code`. Adoção hoje é
incremental — **no alvo é universal**, via `lib/api/with-api.ts`.

### 6.3 Idempotência

Toda operação que move valor ou cria registro externo declara chave única:
`privyId`, `Quote.submitXdrHash`, `LiquidacaoSubmit.xdrHash`, `WalletProvisioning`,
`OnRampOrder.quoteId`, `CessaoComprador.reservaId`, e — novos — `WebhookEvento.eventoId`
(dedupe de entrega repetida) e `SolicitacaoClawback.id`.

### 6.4 Rate-limit

`leadLimiter` (5/60s) · `publicLimiter` (20/60s) · `sensitiveAuthLimiter` (10/60s) ·
`adminLoginLimiter` (5/15min). No alvo, `pool/summary` e `comprovante` entram no
`publicLimiter`, e webhooks ganham limiter próprio por fornecedor.

**Limite por pessoa não é rate-limit, e não pode virar um.** Rate-limit protege infraestrutura e
conta por IP e rota; o que a fase 01 precisa é limite **por documento**, que é regra de negócio e
vive no serviço, com `EventoAudit` e chave de idempotência (§6.3). Trocar um pelo outro dá a
sensação de proteção e nenhum efeito: quem tenta fraude troca de IP antes de trocar de CPF.

Hoje não há onde apoiar essa regra. `LeadComprador.documento` é `String?` **sem `@unique` e sem
índice**, e a única chave da tabela é `email @unique` — e-mail é trivial de variar. Os campos
normalizados entram na §9.3; `lib/format/parse-cpf.ts` e `parse-cnpj.ts` já existem e são a base.

**E a ponta que importa na fase 01 é a do cedente, não a do comprador.** É ali que sai dinheiro
da Plina por PIX contra um direito creditório. `LeadVendedor` tem `nome`, `email`, `cpf?` e
**nenhum campo que identifique a cota** — administradora, grupo, número e valor de face não
existem no funil; a cota só ganha identidade quando um operador a incorpora à mão. Sem isso não
há como detectar a mesma cota oferecida duas vezes, nem ligar oferta a cota antes de pagar. A
identidade lógica da cota no funil (§9.3) é pré-requisito do controle, não enfeite.

### 6.5 Feature flags

`MAINNET_ENABLED` (kill-switch) · `M3_INSTITUTIONAL_GATING` · `INTL_INVESTOR_FLOW` ·
`CUSTODY_PROVIDERS` · `SOROBAN_WATERFALL` · `BUYER_SELF_REALIZACAO` · `LAB_ENABLED`.
Canônicas no Edge Config, default `false`, fail-closed. Novas no alvo:
`ANCHOR_PROVIDER` (seleção de adaptador) e `SCREENING_ENABLED`.

### 6.6 Segurança de plataforma

| Item | Alvo | Estado |
|---|---|---|
| `next` sem CVE aberto | linha 16.x corrigida | 🔧 hoje 16.2.4, CVE-2026-23870 aberto |
| Headers de segurança | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | 🆕 `next.config.ts` sem `headers()` |
| Comprovante PDF | acesso vinculado ao dono ou token assinado com expiração | 🔧 hoje capability URL permanente |
| WAF | Vercel Firewall | 🆕 M0 Fase 2 |
| Secrets | só server-side, custódia em mainnet | ✅ |

---

### 6.7 O guard de cutover é um choke point

Espalhar `mainnetCutoverGuard()` por vinte rotas é o padrão que produziu o estado atual —
três rotas cobertas de quarenta e seis. Guard adicionado à mão é guard esquecido no próximo
PR.

O alvo repete a solução que já funciona no projeto para autenticação:

1. **Aplicação central.** O wrapper `lib/api/with-api.ts` recebe a classificação da rota e
   aplica o guard. Server Action equivalente recebe o mesmo tratamento via `requireAdmin`.
2. **Classificação declarada**, não inferida: a rota declara se move valor. Ausência de
   declaração é erro, não default permissivo.
3. **Lint bloqueante no `prebuild`**, no mesmo molde do `require-auth-guard.mjs`: superfície
   mutante sem classificação quebra o build, com allowlist explícita e justificada.

**As duas superfícies contam.** O lint de auth hoje varre `app/api/**`, mas a §5.2 move a
mutação do painel para Server Actions — e duas delas movem dinheiro: `executarPagamentoAction`
(que em mainnet chama o PSP) e `executarRealizacaoAction`. Server Action não vive sob
`app/api/**`. Se o lint só olhar para lá, o princípio 8 fica falso justamente no caminho que a
operação usa todo dia. O varredor cobre `app/api/**` **e** os módulos de Server Action
(`**/actions.ts`), e `requireAdmin(papel)` recebe a mesma classificação que o `with-api`.

Trade-off aceito: perde-se granularidade fina por rota, que este produto não precisa. Ganha-se
a propriedade de que o princípio 8 **continua verdadeiro** sem ninguém lembrar dele.

O mesmo raciocínio vale para o `operadorId` do princípio 7: se depender de cada handler
passar a identidade, uma hora alguém não passa. Ele deve vir do contexto de autenticação.

### 6.8 Operações de várias pernas e recuperação

O princípio 1 diz em que **ordem** gravar. A §6.3 diz como não **duplicar**. Nenhum dos dois
diz o que acontece quando a perna 3 falha com a perna 2 já confirmada on-chain — e é exatamente
aí que o dinheiro fica parado.

Não é hipótese: a §11.2 já prevê *"ordem de saída sem transação"* como SEV1, e a §11.3
estabelece que a reconciliação **nunca corrige sozinha**. Ou seja, hoje o sistema detecta a
operação travada, acorda alguém, e não oferece caminho de volta.

**Regra: toda operação de mais de uma perna declara três coisas** — estado intermediário
persistido (enum no schema, nunca inferido por ausência de registro), classe de recuperação, e
quem tem o botão. Fluxo sem as três não vai para mainnet.

Três classes de recuperação, e só três:

| Classe | Significado | Quem executa |
|---|---|---|
| **Retomável** | a perna é idempotente por chave já existente; reexecutar é seguro | automático, com teto de tentativas e alerta depois |
| **Reparável** | precisa de decisão ou de dado novo (XDR expirado, carteira sem trustline) | operador, por ação no painel |
| **Irreversível** | efeito on-chain consumado, não há desfazer | ninguém — só registro contábil e comunicação |

#### Onde cada fluxo pode parar

**Entrada — compra de cota.** `onramp/create` → PIX pago → `claim/{build,submit}` → `swap/{build,submit}`

| Falha entre | O que fica pendurado | Classe | Reparo |
|---|---|---|---|
| PIX confirmado e `claim` | dinheiro entrou, investidor sem ativo | retomável | reclamar o claimable balance; a chave é o id do balance, repetir é seguro |
| `claim` e `swap` | investidor com ativo-ponte, sem cota | reparável | reexecutar o swap, regenerando o XDR se expirou. Não é perda: é posição parada no ativo errado |
| dentro do `swap` | nada | — | o swap é atômico por construção; as duas pernas passam ou nenhuma passa |
| `swap` confirmado e gravação em banco | chain certa, Postgres atrás | retomável | reprojetar a partir do Horizon. **Nunca reemitir transação** — a chain é a verdade (princípio 1) |

**Saída — resgate.** `liquidar/{quote,build,submit}` → `offramp/create` → `offramp/{signing-tx,submit}` → PIX recebido

| Falha entre | O que fica pendurado | Classe | Reparo |
|---|---|---|---|
| liquidação e `offramp/create` | investidor com ativo-ponte, sem BRL | reparável | criar a ordem de saída; a posição segue rendendo enquanto isso |
| `offramp/create` e o XDR | ordem aberta sem transação — a falha silenciosa | reparável | o pré-check de carteira da §4.5 evita criar a ordem; ordem já criada se cancela e refaz |
| XDR submetido e confirmação do PSP | dinheiro em trânsito | **nenhuma — só espera** | aguardar o webhook. Reemitir aqui é pagar duas vezes |

**Originação — cessão.** oferta aceita → assinatura → PIX ao cedente → incorporação da cota ao pool

| Falha entre | O que fica pendurado | Classe | Reparo |
|---|---|---|---|
| assinatura e PIX | obrigação jurídica assumida, cedente não pago | reparável | o prazo aqui tem consequência contratual, não só operacional |
| PIX e incorporação | caixa saiu, cota fora do pool — **o NAV fica subestimado** | reparável | incorporar; alerta próprio, porque contamina o número da [§8.2](#82-publicação-de-nav) |

#### Regras que valem para os três

- **Retry só sobre chave de idempotência existente.** Sem chave declarada (§6.3) a perna não é
  retomável — é reparável, por mais repetível que pareça.
- **Antes de reexecutar qualquer perna com efeito on-chain, consultar o Horizon.** O Postgres é
  cache e pode estar atrás do que já aconteceu.
- **Reparo é ato administrativo.** Grava `EventoAudit` com `operadorId` (princípio 7) e o estado
  de origem. Reparo silencioso é pior que operação travada.
- **Se não tem botão, não é reparável.** Toda linha marcada "reparável" precisa de ação
  correspondente em `/admin/ops`; sem isso vira chamado de engenharia com investidor esperando.
- **Reparo não cria valor.** Reexecuta a perna prevista ou registra o ocorrido — nunca emite,
  paga ou queima fora do fluxo normal.
- **Todo estado intermediário tem prazo.** Vencido, vira alerta com a severidade da §11.2.
  Estado pendente sem relógio é estado esquecido.

---

## 7. Integrações e portas

### 7.1 As duas portas que existem

| Porta | Arquivo | Contrato | Adaptadores |
|---|---|---|---|
| `Kyc` 🆕 | de `lib/anchors/types.ts` | verificação de identidade: criar organização, submeter dados e documentos, ler requisitos e estado | fornecedor atual (PF, fase 01); KYB e outras jurisdições na fase 02 |
| `Ramp` 🔧 | `lib/integrations/<fornecedor>/` | quote, on/off-ramp, conta bancária | **um só, e sem consumidor vivo na fase 01** — porta genérica só em M4 |
| `StellarSigner` | `lib/stellar/signer.ts` | `publicKey()`, `signEnvelope()` **async** | multisig por guarda própria (fase 01) ou custodiante (fase 02) |

**A `Anchor` era uma porta só, e a fase 01 mostrou a costura.** O que está de fato em uso hoje
é apenas o **KYC de pessoa física** — cedente e comprador. A metade de rampa tem **zero
consumidores vivos na fase 01**: o rail BRL não é GA (§2.3) e a originação não precisa dele,
porque roda por PIX off-chain. Pela regra que a própria §7.2 estabelece — porta genérica só
nasce com o segundo consumidor real — `Ramp` não deveria ser porta ainda, e volta a ser
integração concreta até M4 trazer a segunda implementação.

Partir também desfaz uma restrição que ninguém escolheu, só herdou: **um provedor de KYC não
precisa ser um anchor**. Para PF no Brasil, Idwall, Unico ou Serpro resolvem sem tocar em
Stellar. Amarrar identidade ao fornecedor de rampa fecha essa porta sem motivo.

**Quando fazer: dentro da migração do anchor** (§13, item 1), que já vai reescrever esse
adaptador inteiro porque os endpoints mudaram e o sunset venceu em 16/08. Partir durante uma
reescrita que já vai acontecer é quase de graça; partir depois é projeto próprio.

O `StellarSigner` isola o segredo mais sensível do sistema e sustenta o comportamento
fail-closed — mas **não se pagou sem ressalva, e a ressalva é que a porta é contornada**. Cinco
call-sites leem `process.env.STELLAR_*_SECRET` direto, como guarda, *antes* de chamar o signer:
`lib/services/tokenizacao.ts:62` e `:169`,
`app/api/investidor/buy/trust-plinarf/submit/route.ts:71`,
`app/api/investidor/buy/swap/build/route.ts:148` e `app/api/lab/submit-tx/route.ts:55`. Em
guarda própria com multisig — a escolha da fase 01 — essa variável **não existe**, então esses
caminhos quebram mesmo depois de o item 10 da §13 corrigir `custodyConfigured()`: o item
conserta a porta, não quem passou por cima dela.

No alvo a propriedade vira estrutural pelo padrão que o repositório já usa e confia — um lint
de `prebuild` irmão de `scripts/lint/require-auth-guard.mjs`, proibindo esses identificadores
fora de `lib/stellar/signer.ts`. Vale o mesmo raciocínio da §8.2: propriedade que depende de
alguém lembrar é propriedade que se perde na próxima rota.

**Nota sobre o signer:** com custódia real a assinatura vira assíncrona (a política pode
exigir aprovação humana). O contrato precisa migrar de `sign(tx): void` para
`signEnvelope(): Promise<string>` **antes** de plugar o fornecedor — hoje os call-sites
assumem assinatura síncrona.

A porta isola *como* se assina. *Quem* detém a chave, com que redundância e o que acontece se
ela se perder é a [§10.5](#105-continuidade-e-recuperação-de-desastre) — e é o único cenário
deste documento que não tem reparo.

### 7.2 As integrações que não devem virar porta ainda

DocuSign, PSP de PIX, APIs das administradoras e screening têm hoje apenas READMEs de
interface em `lib/integrations/` — **contrato desenhado, zero implementação**. Dois deles
nem têm fornecedor escolhido.

**Regra: escrever a integração concreta primeiro, dentro do serviço que a usa. Extrair a
porta quando aparecer o segundo consumidor real.**

A justificativa está no próprio repositório. O `StellarSigner` foi desenhado com
antecedência, sem nenhuma implementação de custódia existindo — e a primeira coisa que a
integração real exige é **mudar o contrato** de síncrono para assíncrono, tocando todos os
call-sites. Interface desenhada antes da primeira implementação é interface errada; a
diferença é só quando você descobre.

Exceção com data marcada: **administradoras** nascem com dois consumidores conhecidos desde
o primeiro dia (API B2B e fallback de cartório digital, modelados no enum `CaminhoCessao`).
Essa pode nascer como porta.

> Isso não afrouxa o princípio 2. Serviço continua não importando SDK de terceiro
> diretamente: a chamada concreta fica em `lib/integrations/<fornecedor>/`, com uma função
> por caso de uso. O que se adia é a **interface genérica**, não o isolamento.

---

## 8. Camada on-chain

### 8.1 Ativos e operações

| Ativo | Papel | Flags |
|---|---|---|
| `PLINARF` → `PLINARFS` | cota Sênior | `AUTH_REQUIRED` + `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` |
| `PLINARFB` | cota Subordinada | idem |
| `TESOURO` | **ativo-ponte** — atual e preferido | denominado em BRL; ponte cambialmente neutra para o fundo, e rende |
| `USDC` / `EURC` | entrada internacional (M4); ponte alternativa | Circle |

> **A flag do issuer não basta: no Stellar o clawback é por trustline.**
> `AUTH_CLAWBACK_ENABLED` marca com `TRUSTLINE_CLAWBACK_ENABLED` apenas as trustlines criadas
> **depois** que a flag existe. Trustline anterior fica permanentemente fora, e
> `setTrustLineFlags({ clawbackEnabled: false })` é irreversível por trustline — não há como
> religar. Duas consequências operacionais, e hoje nenhuma está coberta. A primeira é a **ordem
> no cutover**: `configureIssuerFlags` antes de qualquer `changeTrust`. O `scripts/smoke-stellar.ts`
> já acerta isso; o [`runbooks/mainnet-cutover.md`](./runbooks/mainnet-cutover.md) tem uma linha
> sobre as flags e não diz a ordem. A segunda é que **autorizar é o ponto de recusa**:
> `is_clawback_enabled` não é lido em lugar nenhum do repositório, embora o campo exista tipado
> no SDK já instalado. No alvo, `authorizeTrustline` falha fechado quando a trustline não é
> clawbackable — autorizar sem isso é criar um holder fora das quatro hipóteses do whitepaper
> §6.5, e um holder assim é **indistinguível dos outros em qualquer tela**, o que faz a
> descoberta acontecer no dia em que o clawback é obrigação regulatória e a operação falha. A
> verificação contínua entra na [§11.3](#113-reconciliação).

> **O código diz `PLINARF`, não `PLINARFS`.** A decisão registrada em `lib/stellar/classes.ts:7`
> é *"PLINARF legacy = Sênior"*: o ativo existente continua sendo a Sênior, e a Subordinada
> nasceu com code novo. A renomeação para `PLINARFS` só acontece na **reemissão do cutover
> (M9)**, num issuer limpo e sem holders a migrar. Quem for implementar hoje procura
> `PLINARF` — o code vem de `ASSET_CODE`, e é por isso que ele é configuração.

> **A ponte é configuração, não constante.** O símbolo do ativo-ponte é parâmetro
> (`resolveBridgeAsset`), resolvido em runtime via `GET /ramp/assets`. Trocar é mudar
> configuração, não código. **TESOURO segue como valor atual e como preferência**: sendo
> denominado em BRL, mantém o fundo cambialmente neutro — passivo e ativos em real — e
> ainda rende no caixa não aplicado. Migrar para USDC só se o fornecedor descontinuar
> TESOURO no rail BR, ou se M4 mostrar que unificar a ponte compensa a exposição cambial.
> Ver [`PLANO-MIGRACAO-ANCHOR.md §3`](./PLANO-MIGRACAO-ANCHOR.md).

> **O emissor da ponte é entrada de risco, não só de configuração.** Consulta ao Horizon em
> 2026-09-11, no issuer de sandbox (`GC3CW7ED…UPS4`, `home_domain sand.etherfuse.com`): as
> quatro flags **desligadas** — o caixa do fundo não é clawbackable nem congelável hoje —, mas
> `auth_immutable` também é `false`, e a conta tem **um signatário de peso 1 com thresholds
> 0/0/0**. Ou seja: o perfil de hoje não é garantia do perfil de amanhã, e se o clawback for
> ligado depois, toda trustline criada a partir dali nasce clawbackable. Some-se que o ativo em
> que o caixa está denominado é emitido por uma conta operando com **exatamente o padrão que o
> princípio de assinatura deste documento proíbe para a própria Plina** (§10.5). Nada disso é
> argumento para trocar de fornecedor — a razão de §2.3 é comercial e vale mais que o atrito. É
> argumento para que o perfil do emissor vire **número monitorado**, como o saldo do issuer já
> é: gate contra o issuer de **mainnet** antes do cutover — a conta será outra — e checagem no
> mesmo cron do NAV depois ([§11.3](#113-reconciliação)). Onde o caixa realizado fica —
> TESOURO, pela neutralidade cambial acima, ou fiat no PSP — passa a ser decisão registrada em
> vez de default herdado ([§14](#14-decisões-pendentes), item 12).

Operações: emissão via distributor, swap atômico de duas pernas, resgate, clawback restrito
às 4 hipóteses, e `memo.hash` de auditoria em toda transição. Detalhe pequeno que morde: o
limite de `memo.text` é **28 bytes** e `lib/stellar/transactions.ts:98` corta por caractere
(`slice(0, 28)`). Em PT-BR cada acento são dois bytes, então o primeiro memo legível por
humano lança em runtime — só não explodiu porque o único memo em uso hoje é `q:<id>`, ASCII.

> **O resgate não queima — devolve à tesouraria.** A decisão existe desde o MVP e vivia só num
> comentário de serviço (`lib/services/liquidacao.ts:14`): o PLINARF resgatado volta ao
> distributor e fica disponível para a próxima captação, em vez de ser queimado. Sobe para cá
> porque **muda o que "supply" significa** para o auditor e para quem lê o Stellar Expert: o
> supply on-chain nunca decresce, e a diferença entre supply e circulante é tesouraria, não
> emissão nova. Consequências: o denominador do NAV é o circulante e não o supply (§8.2), a
> reconciliação da §11.3 precisa das três quantidades, e a ficha técnica publica as três com
> esses nomes. Queimar seria a alternativa — mais legível de fora, mais cara em operação, porque
> cada captação nova exigiria emissão nova e a política de emissão passaria a ser exercida toda
> semana em vez de raramente.

**Soroban (M7):** `waterfall.rs` (despesas → yield Sênior → performance fee → Subordinada).
Hoje a cascata roda em Postgres (`lib/services/pool.ts`); a migração é gated por
`SOROBAN_WATERFALL` e exige auditoria externa do contrato antes de valer em mainnet.

> **`nav_oracle.rs` sai do alvo.** A especificação era "publica o `NavSnapshot` diário, escrita
> só pelo issuer multisig" — um contrato que guarda um número que a Plina calculou e assinou.
> Isso é exatamente o que a âncora por `memo.hash` da [§8.2](#82-publicação-de-nav) já entrega:
> carimbo de tempo e evidência de adulteração. Não é mais verificável; é o mesmo pressuposto de
> confiança, com custo de execução e com a auditoria externa de contrato que o parágrafo acima
> já exige. **Contrato é o item mais caro do roadmap, e por isso vale gastá-lo no que hoje não
> tem garantia nenhuma:** o holder não tem defesa on-chain contra `AUTH_REVOCABLE`. A Plina
> pode congelar qualquer posição unilateralmente — inclusive para não honrar um resgate — e o
> que impede isso hoje é reputação, que é precisamente o que uma mesa de risco institucional
> não aceita como controle. Garantia de saída (claimable balance com predicado temporal, ou
> janela de contestação antes da revogação) é o candidato a ocupar o orçamento liberado.
> Registrado como decisão em [§14](#14-decisões-pendentes), item 13, porque troca escopo por
> escopo e não é escolha de implementação.

### 8.2 Publicação de NAV

Do NAV dependem preço de emissão, valor de resgate, cascata e ficha técnica. Ele é calculado
off-chain e **ancorado on-chain** — e ancorar é irreversível, como o clawback. A diferença é
que o clawback tem dupla aprovação (§5.4) e o NAV roda sozinho, num cron, sem ninguém olhando.

**O cálculo é derivado, não armazenado.** As funções de `lib/services/pool.ts` são puras e
usam `Decimal` — isso está certo e se mantém. `NavSnapshot` é fotografia datada, nunca fonte:
ninguém lê NAV do snapshot para precificar, lê do cálculo.

**Três níveis, não um número.** Hoje existe um só: `navTotalDoPoolAsDecimal`
(`lib/services/pool.ts:97`) soma cotas ativas a valor presente mais caixa realizado, e é isso
que se publica. Faltam as duas deduções que o modelo econômico prevê, e o alvo separa os três
níveis explicitamente:

```
NAV dos ativos       Σ cotas ativas a valor presente + caixa do razão       ← razão, não soma de tabelas (abaixo)
− provisões          inadimplência e cota em atraso                         ← política do fundo, ainda inexistente
− taxas apropriadas  administração acumulada + performance provisionada
= NAV líquido        o número que precifica emissão e resgate

NAV líquido por token = NAV líquido ÷ tokens em circulação                  ← Horizon, não Postgres (abaixo)
```

**"NAV bruto" era vocabulário impreciso** e sai: ele cobria só a ausência de provisão, quando o
número também é bruto de taxa. Cada nível tem nome próprio, e a ficha técnica publica **a ponte
entre eles**, não só o resultado — é o "de onde vem a margem" do one-page virando verificável em
vez de declarado.

**A taxa de administração entra desde o primeiro snapshot; a de performance espera.** Os 2% a.a.
são número firme (one-page). Já a performance é 20% sobre o excedente do benchmark, e o
yield-alvo da Sênior é a decisão [§14.5](#14-decisões-pendentes) — sem ele não há excedente a
calcular. Enquanto isso, o NAV publicado **declara** que a provisão de performance não entra:
declarar é o que impede um número meio líquido de ser lido como líquido.

**Apropriar sempre, liquidar nunca na fase 01.** A taxa acumula como obrigação com o gestor e
reduz o NAV; o caixa não se move. Na fase 01 pagador e recebedor são a mesma empresa (Escopo), e
mover dinheiro entre duas contas dela é teatro contábil que só gera ruído de reconciliação — mas
o número fica certo e a mecânica chega exercitada na fase 02.

> **Por que não deixar para a fase 02, se na fase 01 a Plina cobra de si mesma.** Porque a série
> de NAV da fase 01 **é** o track record que sustenta a fase 02 — foi o argumento que decidiu o
> escopo. Publicar bruto agora e líquido depois põe uma descontinuidade exatamente onde o
> analista de rating vai olhar, com a metade que parece melhor sendo a que não tinha investidor.
> E recalcular depois não é reprocessar: cada snapshot está **ancorado on-chain**, e correção é
> registro novo (abaixo). Restaurar um ano de série significa 250 e poucas âncoras de correção e
> uma conversa com o auditor sobre por que a série publicada inteira estava errada. Num banco
> comum "a gente reprocessa depois" seria resposta; aqui a própria arquitetura fecha essa porta.

**As convenções de apropriação são parâmetro, não código.** Base de dias, base de incidência e
regra de cristalização da performance entram em `ParametrosPool` (§9.3) e são decisão de
jurídico/estruturador, não de engenharia — [§14.11](#14-decisões-pendentes). O alvo recomenda
**252 dias úteis** (o benchmark é CDI, que é 252; misturar 365 na taxa e 252 no benchmark produz
erro sistemático no excedente, de 0,0079% ao dia, que ninguém percebe olhando), incidência sobre
o **NAV líquido do dia anterior** (evita taxa sobre a própria taxa do dia) e cristalização **por
janela de liquidez, com marca d'água**.

#### O denominador vem da chain

Há **três** quantidades de token, e o código trata as três como uma:

| | O que é | Onde se lê |
|---|---|---|
| **supply** | tudo que o issuer emitiu | Horizon, `amount` do ativo |
| **em circulação** | supply − tesouraria (o que voltou ao distributor no resgate) | Horizon, duas leituras |
| **lastreado por cota ativa** | `tokensEmitidos` das cotas `DISPONIVEL`/`RESERVADA` | Postgres — **é o que `tokensEmitidosVivos` usa hoje** |

O denominador do NAV/token é o **em circulação**. Hoje é o terceiro, e o erro não é marginal:
quando uma cota é realizada, o caixa entra no numerador *e* os tokens dela saem do denominador —
conta dobrada. Com duas cotas de 80 tokens, uma realizada por R$ 90 e outra ativa a R$ 80, o
correto é `170 ÷ 160 = 1,0625` e o código devolve `170 ÷ 80 = 2,1250`. No caso limite em que toda
cota foi realizada, o denominador zera e `navPorToken` retorna **0** — e `lib/services/liquidacao.ts:94`
precifica o resgate com essa função. Um investidor que resgatasse ali receberia `amount × 0`.

**Correção:** `circulante = amount do ativo (Horizon) − saldo do distributor`, por asset code. É o
princípio 1 aplicado ao denominador do preço, que hoje é a única parte da precificação que ignora
a chain.

#### O caixa vem de um razão, não de uma soma de tabelas

`caixaRealizadoAsDecimal` soma `valorRealizado` das realizações. **Nada subtrai o caixa pago a
quem resgatou.** Hoje está mascarado porque o pagamento é BRL fictício (§4.3); com off-ramp real,
o NAV passa a superestimar pelo total já resgatado, de forma cumulativa e silenciosa. A taxa
apropriada decidida acima seria a próxima omissão pelo mesmo motivo.

A causa é comum aos dois: **o NAV é derivado de tabelas operacionais — cotas e realizações — em
vez de um razão do fundo.** Cada forma nova de mover dinheiro exige lembrar de somar um termo à
fórmula. É a mesma falha da §6.7, onde espalhar o guard de cutover à mão produziu três rotas
cobertas de quarenta e seis; e a resposta é a mesma: tornar a propriedade **estrutural em vez de
lembrada**.

**Alvo:** modelo append-only `MovimentoFundo` (§9.2), uma linha por movimento — aquisição de cota,
realização, resgate pago, taxa apropriada, taxa liquidada, aporte. Caixa do fundo é a soma do
razão. A propriedade que isso compra é que **um tipo novo de movimento não consegue se omitir do
NAV**, porque não há caminho para o dinheiro que não passe por uma linha. O backfill é barato
enquanto não há mainnet: as realizações existentes viram lançamentos.

> **Trade-off registrado.** A alternativa barata é corrigir as fórmulas onde estão, sem razão.
> Custa dias em vez de semanas e funciona — até o quarto tipo de movimento aparecer, que na prática
> é a liquidação da taxa de administração. Se o calendário da fase 01 forçar essa escolha, ela é
> defensável **desde que fique escrito que o NAV passa a depender de alguém lembrar**, com data
> para pagar a dívida. O que não é defensável é fazer a versão barata e chamar de pronto.

#### O preço de emissão também vem do NAV — e hoje vem de dois lugares

As duas correções acima são do **lado do ativo**: o que o fundo tem. Falta a do lado do
passivo, e ela é maior, porque não é um termo esquecido numa fórmula — são **duas fórmulas
diferentes criando o mesmo token**:

| Caminho | Onde | Quantos tokens nascem |
|---|---|---|
| Incorporação de cota | `tokensParaEmitir`, `lib/services/pool.ts:198` | NAV em reais, truncado para inteiro — **1 token por R$ 1** |
| Subscrição do investidor | `app/api/investidor/buy/swap/build/route.ts:248` | `quote.toAmount`, que é quantidade de **TESOURO** — **1 token por TESOURO** |

As duas réguas só coincidem se o TESOURO valer exatamente um real. Ele não vale: o
`smoke-etherfuse-output.json` do próprio repositório registra `fromAmount` R$ 100 →
`toAmount` 86,57452869 TESOURO, a uma `exchangeRate` de 0,86574528. O ativo-ponte **rende** —
é o que a §8.1 elogia nele — e render é exatamente o que faz o preço andar. Mesmos R$ 100 dos
dois lados da operação, **R$ 1,0000 por token no ativo e R$ 1,1551 por token no passivo**:
15,5% de diferença, hoje, em sandbox.

> **A premissa "1:1" está escrita em três lugares e é falsa nos três.** O PRD §2.5 diz
> "BRL → TESOURO (1:1 via Etherfuse)". O comentário de `swap/build/route.ts` diz que "a swap é
> 1:1 NAV", fundindo duas coisas distintas — *1:1 com a ponte* e *ao NAV* — que só coincidem
> nessa hipótese falsa. E `assertSwapXdrMatchesQuote` compara **as duas pernas ao mesmo
> `expectedAmount`**: a paridade não é só suposição de documentação, está codificada dentro do
> validador de segurança, que hoje **não consegue expressar** um preço diferente de 1:1.

**A correção não é ajustar a conta nos dois lugares; é remover um dos dois caminhos.** Uma
cota que entra no pool é **lastro**: aumenta o NAV, não o supply. Emitir token contra o ativo
que entra é o que fixa estruturalmente "um token por real" — e é também o que abre a janela da
[§6.8](#68-operações-de-várias-pernas-e-recuperação) na incorporação, já que `incorporarCota`
minta on-chain e grava depois, e uma queda de processo entre as duas etapas deixa supply sem
lastro, em silêncio e para sempre.

No alvo:

- **incorporar cota não emite.** Grava um lançamento em `MovimentoFundo` (acima) e nada mais.
- **token nasce só contra aporte**, por `valorBrl ÷ NAV líquido por token`, com `valorBrl`
  vindo de `quote.fromAmount` — o que o investidor pagou — e não de `toAmount`.
- **o `Quote` persiste o preço:** `navPorTokenNaCotacao` e `plinarfAmount`, este separado de
  `toAmount`, porque as duas pernas do swap deixam de ter o mesmo valor.
- **o validador recebe dois amounts**, `expectedBridgeAmount` e `expectedPlinarfAmount`.
  Poucas linhas, mas em código de segurança — motivo para fazer em testnet, e não sob pressão
  de captação.

**O que isso compra além do preço certo.** O supply passa a crescer só contra aporte, então as
três quantidades da §8.1 — supply, circulante, tesouraria — derivam de um lugar só; e a janela
de emissão sem reconciliação **desaparece** em vez de precisar de reparo. É a mesma preferência
por propriedade estrutural das duas subseções acima, aplicada uma terceira vez.

> **Por que não deixar para a fase 02, se hoje a Plina é a única holder.** Mesmo motivo da taxa
> de administração: a série da fase 01 **é** o track record. Um histórico em que o passivo está
> denominado em TESOURO e o ativo em reais não é um histórico ruim — é um que **não fecha**, e é
> exatamente o que o analista vai conferir. A diferença para a taxa é que ali a versão barata
> existia e podia ser declarada; aqui não há o que declarar, porque não há uma régua errada e
> sim duas.

#### Por classe, o que dá e o que não dá

`NavSnapshot.classeSeniorNav` e `classeSubordinadaNav` estão no schema desde
`20260527054949_prd_v1_extensions` e **nenhuma linha de código escreve neles**. O rateio entre as
classes depende da cascata, que depende do yield-alvo da Sênior — decisão [§14.5](#14-decisões-pendentes) —,
então o preenchimento fica bloqueado e os campos seguem como dívida visível (§9.4).

O que **não** depende de nada é fazer tudo **por asset code**: `PLINARFS` e `PLINARFB` têm supply,
tesouraria e circulante próprios, e tanto o gate abaixo quanto a reconciliação da §11.3 rodam por
ativo. Um cálculo escrito no singular hoje passa em testnet com uma classe só e quebra no primeiro
aporte subordinado.

**Gate de sanidade antes de ancorar.** O cron das 18:00 valida e só então publica:

| Verificação | Se falhar |
|---|---|
| variação contra o snapshot anterior dentro da banda (`ParametrosPool.bandaVariacaoNavPct`) — **líquido contra líquido**, nunca comparando níveis diferentes | não publica · SEV2 |
| apropriação de taxa do dia calculada e aplicada, com a mesma convenção do snapshot anterior | não publica · SEV2 |
| NAV líquido e NAV líquido por token maiores que zero | não publica · SEV1 |
| toda cota ativa com parâmetros de precificação completos | não publica · SEV2 |
| **por ativo**, circulante do Horizon (supply − tesouraria) conferindo com Σ `HoldingPLINARF` (§11.3) | não publica · SEV1 |
| caixa do razão não negativo, e todo lançamento do dia com contrapartida rastreável (ordem, tx ou apropriação) | não publica · SEV1 |

**Falhar é não publicar.** Ausência do snapshot do dia é um alerta que alguém resolve pela
manhã; snapshot errado ancorado é permanente. É o princípio 3 aplicado ao número mais sensível
do produto — e é a razão de o gate existir antes da âncora, não depois.

**Correção é snapshot novo, nunca `UPDATE`.** Se um NAV publicado estiver errado, grava-se
outro registro apontando para o corrigido (`corrigeSnapshotId` + motivo), com aprovação de um
`APROVADOR`. O hash antigo continua ancorado: não há como apagar, e a resposta certa é
declará-lo ao auditor — mesmo raciocínio da §9.5.

**A banda é parâmetro, não constante no código**, e seu valor inicial ainda não existe. É a
decisão pendente [§14.7](#14-decisões-pendentes). Até que ela seja tomada, o gate roda em modo
observação: calcula, alerta e não bloqueia — chutar a banda agora só produziria um número que
vira fato por repetição.

---

## 9. Modelo de dados

O schema atual (`prisma/schema.prisma`) é sólido e a regra é **estender, nunca substituir**.
Catálogo completo dos modelos existentes na [`DOCUMENTACAO-TECNICA.md §9`](./DOCUMENTACAO-TECNICA.md).
Esta seção descreve só o que o alvo acrescenta ou muda.

### 9.1 Fronteira on-chain / off-chain

Não é convenção de estilo — é o contrato de LGPD do produto, e vale para todo modelo novo.

| Fica no Postgres (Brasil) | Vai para a chain |
|---|---|
| nome, CPF/CNPJ, endereço, e-mail, telefone, documentos, dados de KYC/KYB | `payloadHash` (SHA-256 do payload canônico) |
| valores, status, relacionamentos, trilha completa | endereço Stellar, timestamp, hash da transação |

Todo modelo novo que participe de uma transição de estado grava `EventoAudit` com
`payloadHash` ancorado via `memo.hash`. Sem exceção.

Esta seção diz **onde** o dado pessoal vive. Por quanto tempo, e o que acontece no fim, é a
[§9.8](#98-ciclo-de-vida-do-dado-pessoal).

### 9.2 Modelos novos

| Modelo | Propósito | Campos-chave |
|---|---|---|
| `AdminUser` | identidade nomeada do operador — substitui a senha única (§5.3) | `id` · `externalId` 🔑 (Clerk) · `email` 🔑 · `nome` · `papel` (`AdminPapel`) · `ativoDesde` · `desativadoEm` |
| `SolicitacaoClawback` | fluxo de dupla aprovação (§5.4) | `id` · `investidorId` · `amount` · `motivo` (`MotivoClawback`) · `fundamentoUrl` · `hashDocumento` · `solicitanteId`→AdminUser · `status` · `expiraEm` · `executadoTxHash` |
| `AprovacaoClawback` | uma linha por aprovador | `id` · `solicitacaoId` · `aprovadorId`→AdminUser · `papel` · `aprovadoEm` · `@@unique([solicitacaoId, aprovadorId])` |
| `WebhookEvento` | entregas do anchor e de terceiros, append-only | `id` · `fornecedor` · `eventoId` 🔑 (dedupe) · `tipo` · `payloadJson` · `assinaturaValida` · `recebidoEm` · `processadoEm` · `erro` |
| `ScreeningResultado` | OFAC/UE/ONU/PEP por pessoa (M6) | `id` · `pessoaId` · `provedor` · `listas[]` · `resultado` · `scoreJson` · `revisadoPor`→AdminUser · `verificadoEm` |
| `LeadEoi` | waitlist institucional — **já existe em produção e não está documentado** | `id` · `nome` · `org` · `email` · `jurisdiction` · `ticket` · `classe` · `status` |
| `SolicitacaoTitular` | pedidos de titular sob LGPD (§9.8) — acesso, correção, eliminação, portabilidade | `id` · `pessoaId` · `tipo` · `canal` · `recebidaEm` · `prazoEm` · `status` · `respondidaEm` · `respostaResumo` · `tratadaPorId`→AdminUser |
| `MovimentoFundo` | razão append-only do caixa do fundo (§8.2). Todo movimento de dinheiro é uma linha; caixa é a soma, nunca uma fórmula que soma tabelas | `id` · `data` · `tipo` (`AQUISICAO_COTA`, `REALIZACAO`, `RESGATE_PAGO`, `TAXA_APROPRIADA`, `TAXA_LIQUIDADA`, `APORTE`) · `valor` `@db.Decimal(20,2)` (sinal explícito) · `assetCode` · `cotaId?` · `investidorId?` · `referenciaExterna` 🔑 (ordem, txHash ou chave de apropriação — é a idempotência do §6.3) · `registradoPorId`→AdminUser? · `payloadHash` |

### 9.3 Campos acrescentados a modelos existentes

| Modelo | Campos | Motivo |
|---|---|---|
| `Pessoa` | `orgAccountType` (`personal`/`business`) · `kycRequirementsJson` · `kycUserMessage` | verificação assíncrona dirigida por requisitos; o `userMessage` do anchor é *point-in-time* e some se não for persistido na chegada |
| `Pessoa` | `anonimizadaEm` · `anonimizadaPorId`→AdminUser | eliminação sob LGPD é anonimização, não `DELETE` (§9.8) |
| `Investidor` | `kybOrganizationId` · `kybStatus` · `kybApprovedAt` | KYB é produto distinto do KYC (§2.3) |
| `EventoAudit` | `operadorId`→AdminUser | princípio 7 — `operador` como string livre deixa de bastar |
| `ParametrosPool` | `bridgeAssetSymbol` · `bandaVariacaoNavPct` | ativo-ponte vira configuração (§8.1); banda do gate de NAV é parâmetro, não constante (§8.2) |
| `ParametrosPool` | `taxaAdmBps` · `taxaPerformanceBps` · `baseDiasAno` · `baseIncidenciaTaxa` · `cristalizacaoPerformance` · `marcaDaguaAtiva` | convenções de apropriação (§8.2) — decisão de jurídico/estruturador (§14.11), nunca constante no código |
| `NavSnapshot` | `corrigeSnapshotId` · `motivoCorrecao` · `aprovadoPorId`→AdminUser · `ancoradoTxHash` | correção de NAV é registro novo, nunca `UPDATE` (§8.2) |
| `NavSnapshot` | `navAtivos` · `provisoes` · `taxaAdmApropriada` · `taxaPerformanceProvisionada` · `navLiquido` · `navLiquidoPorToken` · `convencoesJson` | os três níveis da §8.2 e a ponte entre eles. `navTotal`/`navPorToken` existentes passam a significar **NAV dos ativos**; o que precifica é `navLiquido`. `convencoesJson` congela as convenções vigentes no dia — série recalculada com convenção nova, sem registro da antiga, é série que ninguém consegue auditar |
| `OnRampOrder` · `LiquidacaoSubmit` · `CessaoComprador` | `estadoSaga` (enum) · `ultimaFalhaEm` · `reparadoPorId`→AdminUser | estado intermediário é enum persistido, não ausência de registro (§6.8) |
| `LeadComprador` · `LeadVendedor` | `documentoNormalizado` (11/14 dígitos, `@@index`) | limite por pessoa é regra de domínio e precisa de chave (§6.4). Hoje `documento` é `String?` sem índice e `cpf` idem; a única chave é `email @unique`, que não segura ninguém |
| `LeadVendedor` | `administradora` · `grupo` · `cota` · `valorFace` · `@@unique([administradora, grupo, cota])` | identidade lógica da cota no funil de venda (§6.4). Sem ela não há como detectar a mesma cota oferecida duas vezes **antes** de o PIX sair |
| `Investidor` | `tetoTicket` · `suitabilityValidaAte` | **fase 02.** Teto por tipo — R$ 10M (qualificado), sem teto (profissional), US$ 5M (intl) — e limite de concentração por cotista são controle regulatório de FIDC, não UX; a validade da suitability alimenta a fila de "suitability vencida" do `/admin/compliance`. Registrados agora para não sumirem de novo; implementados quando M3 for retomado |

### 9.4 Modelos migrados que ainda esperam consumidor

Foram migrados em `20260527054949_prd_v1_extensions` e seguem sem código que os use. O alvo
lhes dá consumidor — enquanto não tiver, são schema morto e devem ser tratados como dívida
visível, não como "pronto":

| Modelo | Consumidor no alvo |
|---|---|
| `NavSnapshot` | cron de NAV às 18:00 BRT com o gate de sanidade da §8.2 + `/pool/nav/historico` (M5) |
| `JanelaLiquidez` | wizard de resgate em `/sacar` (M5) |
| `PrestadorRegulado` | `/compliance` e `/admin/compliance` (M6) — fase 02 |
| `NavSnapshot.classeSeniorNav` · `classeSubordinadaNav` | rateio da cascata entre as classes — **bloqueado** pelo yield-alvo da Sênior (§14.5). Migrados em maio, nunca escritos. Enquanto isso, tudo que **não** depende do rateio roda por asset code (§8.2) |

### 9.5 Migração dos dados existentes

Duas mudanças da §9.3 não são alteração de coluna — são migração com backfill, e precisam de
plano antes de virar código:

**`Pessoa.etherfuseCustomerId` muda de semântica.** Hoje guarda o id gerado pelo fornecedor;
no alvo guarda o UUID da organização que **nós** geramos. Os registros existentes não têm
esse UUID. Ou se cria a organização retroativamente para cada `Pessoa` já cadastrada, ou se
mantém os dois campos durante a transição (`etherfuseCustomerId` legado + `anchorOrgId` novo)
e se trata ausência como "ainda não migrado". A segunda opção é reversível; a primeira não.

**`EventoAudit.operador` → `operadorId`.** A trilha é append-only e histórica: registros
antigos gravaram a constante `'admin-panel'` e **não podem ser reescritos** sem quebrar os
hashes já ancorados on-chain. O campo novo convive com o antigo; consultas por operador
tratam o período anterior como não-atribuível. Isso é uma limitação a declarar ao auditor,
não um problema a esconder.

### 9.6 Premissas não verificadas

Marcadas para não virarem fato por repetição:

| Premissa | Onde impacta | Como verificar |
|---|---|---|
| O anchor envia id de evento estável por entrega | `WebhookEvento.eventoId` como chave de dedupe (§9.2) | inspecionar payload real em sandbox; se não houver, derivar chave de `(tipo, recurso, status, timestamp)` |
| A assinatura de webhook do anchor é HMAC verificável server-side | §6.1 | guia de verificação do fornecedor |
| Clerk como fonte de identidade não conflita com `AdminUser` local | §9.2 | definir sincronização: upsert preguiçoso no login, ou webhook do provedor |

### 9.7 Regras de evolução

- **Idempotência declarada no schema**, não no handler: toda operação que move valor ou cria
  registro externo tem `@unique` explícito (§6.3).
- **Enums para estado**, string livre nunca. `status` como `String` (caso de
  `JanelaLiquidez.status`) é dívida a corrigir.
- **Decimal com precisão explícita** para dinheiro e token — `@db.Decimal(20,7)` para
  quantidade de token, `(20,2)` para BRL. Nunca `Float`.
- **`cuid()` em todo id** — não enumerável. Exceção: ids que espelham UUID de terceiro
  (org do anchor, `Quote.id`).

### 9.8 Ciclo de vida do dado pessoal

A §9.1 resolve onde o dado vive. Falta o resto do ciclo — e há um conflito real aqui, que é
melhor nomear do que descobrir com um pedido de titular na mesa:

- a regulação do veículo e a legislação civil e tributária exigem **reter** registros por
  anos após o encerramento;
- a LGPD dá ao titular direito de **eliminação**;
- a trilha é **append-only com hash ancorado on-chain** — apagar quebra o hash.

**A leitura que a arquitetura assume** (a confirmar com jurídico e DPO, não decidida aqui):
retenção para cumprimento de obrigação legal e regulatória prevalece sobre o pedido de
eliminação enquanto o prazo correr. O que se elimina é o dado pessoal **fora** do registro
regulado; o que se faz com o resto é **anonimizar**, não apagar.

**O mecanismo é a quebra do vínculo.** O que está on-chain é hash, endereço e timestamp — foi
para isso que a §9.1 existe. O endereço Stellar é pseudônimo, e o que o liga a uma pessoa vive
**só no Postgres**. Anonimizar corta esse vínculo: a chain continua íntegra, a contabilidade
continua completa, e o dado deixa de ser atribuível. É a §9.1 pagando dividendo.

| Categoria | Retenção | No fim do prazo |
|---|---|---|
| Lead de funil e `LeadEoi` não convertidos | curta (§14.8) | **exclusão real** — não há registro regulado a preservar |
| Cadastro, KYC/KYB de quem operou | relação + prazo regulatório | **anonimização**: PII nula, `anonimizadaEm` gravado |
| Documentos de KYC no Blob | idem | **exclusão do objeto**, preservando hash e metadados no Postgres |
| Valores, status, relacionamentos | permanente | nunca tocado — não é dado pessoal depois da anonimização |
| `EventoAudit` e `payloadHash` | permanente | **nunca tocado**; já é só hash e identificadores |
| E-mails e comunicação transacional | curta (§14.8) | exclusão |

**Regras de execução**

- **Anonimização é ato administrativo**: `requireAdmin`, `EventoAudit` com `operadorId`, e é
  **irreversível** — não existe "desanonimizar".
- **Idempotente**: rodar duas vezes sobre a mesma `Pessoa` não é erro.
- **Nunca `DELETE` em modelo que participa de trilha.** Chave estrangeira órfã corrompe a
  auditoria de forma silenciosa, que é o pior modo de falhar num registro contábil que a
  fase 02 vai auditar.
- **O pedido do titular vira registro, não e-mail.** `/lgpd` publica o canal; o pedido entra
  como `SolicitacaoTitular` com prazo, dono e resposta arquivada. Prazo vencido é alerta.
- **Backup também guarda PII.** Anonimizar o banco vivo e manter backup de dois anos com o
  dado íntegro não cumpre nada. A janela de retenção de backup é limite superior do que se
  consegue prometer — ver §10.5.

**O que ainda não existe.** Verificado no schema em 2026-08-18: **nenhum** campo de retenção,
anonimização ou expurgo. O ciclo de vida hoje é "guardar para sempre por omissão", que é uma
política — só não é uma escolhida.

---

## 10. Ambientes e configuração

### 10.1 Os três ambientes

| | Desenvolvimento / CI | Preview (por PR) | Produção |
|---|---|---|---|
| Stellar | testnet | testnet | **mainnet** |
| Anchor | sandbox | sandbox | produção |
| Postgres | local ou branch Neon | **branch Neon automática** | Neon `gru1` |
| Rate-limit | in-memory | Upstash | Upstash |
| Flags | `process.env` | Edge Config | **Edge Config** |
| Assinatura | `KeypairSigner` (secret em env) | `KeypairSigner` | **multisig — fail-closed**, por guarda própria ou custodiante |
| `/api/lab/*` e `/lab` | disponível com `LAB_ENABLED` | idem | **404 sempre** |
| Privy | stub em e2e | real | real |

**Regra dura, enunciada por propriedade e não por fornecedor:** com `STELLAR_NETWORK=PUBLIC`,
o sistema **recusa assinar se um único segredo de ambiente for suficiente para produzir
assinatura válida**. Não existe caminho em que mainnet assine com secret em env.

Isso vale igualmente para guarda própria com multisig, Fireblocks ou BitGo — e é uma mudança
com consequência imediata no código. Hoje `custodyConfigured()` (`lib/stellar/signer.ts:56`)
verifica literalmente `FIREBLOCKS_API_KEY` e `FIREBLOCKS_API_SECRET`, ou seja, o invariante
está codificado em torno de **um fornecedor**. Com a decisão de fase 01 (§2.2), mainnet
recusaria assinar mesmo com multisig corretamente configurado, e alguém teria de editar esse
arquivo sob pressão — o pior momento possível para mexer nele. A verificação passa a ser da
topologia de assinatura, não da presença de credencial de fornecedor.

**O funder é exceção declarada.** Ele continua assinando com secret em env mesmo em mainnet
(`lib/stellar/signer.ts:10`) — é chave quente fora da custódia, e a decisão vivia só num
comentário de serviço. Ela se sustenta porque o funder só custeia criação de conta e
trustline, sem poder emitir, autorizar nem mover ativo do fundo; mas o raio de explosão e o
teto diário dela precisam ser tratados como controle, não como detalhe de implementação.

**Identificadores de ativo diferem entre sandbox e produção.** Resolver sempre via
`GET /ramp/assets`, nunca hardcode — vale para o ativo-ponte e para qualquer asset do anchor.

### 10.2 Configuração

Categorias em `.env.example` (sem segredos). Fonte canônica das flags em produção é o **Edge
Config**; `process.env` é fallback de dev/test. Acrescentam-se ao alvo:

| Variável | Para quê |
|---|---|
| `CRON_SECRET` | autenticação das rotas `/api/cron/**` |
| `ANCHOR_WEBHOOK_SECRET` | verificação de assinatura das entregas |
| `BRIDGE_ASSET_SYMBOL` | símbolo do ativo-ponte (§8.1) |
| `CLERK_*` | identidade do painel admin |

### 10.3 Custo é entrada de arquitetura

Para uma empresa levantando US$ 500k, run-rate não é assunto de finanças — é restrição de
desenho. A arquitetura-alvo acumula fornecedores, e cada um tem piso.

| Fornecedor | Modelo | Ordem de grandeza | Observação |
|---|---|---|---|
| Custódia (Fireblocks) | mínimo de plataforma + fee | **o maior item da lista** | o [`ESTUDO-CUSTODIA.md`](./ESTUDO-CUSTODIA.md) registra que é a opção mais cara da categoria para early-stage; self-custody com multisig nativo Stellar é a alternativa de menor custo, com ônus de compliance |
| Anchor | bps sobre volume | escala com AUM | há **partner fee** configurável que pode ser receita, não só custo |
| Vercel + Neon + Upstash + Blob | assinatura + uso | baixo no estágio atual | escala com tráfego, não com AUM |
| Clerk | por usuário ativo | baixo — são operadores internos | |
| DocuSign · PSP · screening | por envelope / transação / consulta | escala com originação | entram no `desagio_total`, não em overhead |
| Observabilidade e alerta | assinatura por volume de dados, ou stack própria | **o PRD marca como risco de budget e este documento não listava** | hoje o alerta sai por SMTP (§11.2). O PRD F-M8-1/F-M8-3 assume Datadog + PagerDuty/Opsgenie e registra o custo como decisão do CEO |
| E-mail transacional | por envio | baixo | fornecedor não decidido: PRD diz Resend, código usa SMTP (§11.2) |
| Auditoria de contrato Soroban (M7) | projeto | US$ 30–50k (PRD §8.4) | só quando houver volume que justifique — fase 02 |

Duas leituras que isso força:

- **Custo por operação entra na precificação.** DocuSign, PSP e screening são custo variável
  por cessão originada e pertencem à fórmula do deságio (PRD §3.4), não ao overhead fixo.
- **A ordem de contratação importa.** Fechar custódia antes de existir volume em mainnet é
  pagar piso sem receita. O runbook de cutover já prevê canary — o mesmo faseamento vale
  para os contratos.

**E falta o principal: os números.** A tabela acima diz "ordem de grandeza" e não traz uma
cifra. Uma coluna de custo sem valor não restringe decisão nenhuma — é opinião com formatação
de tabela. A diferença entre custódia na ordem de US$ 3k/mês e US$ 30k/mês muda a resposta da
decisão pendente §14.3, e hoje o documento não sabe qual das duas é.

Não vou preencher com estimativa: número chutado em doc de arquitetura vira fato por
repetição, que é o que a §9.6 existe para impedir. O que fica registrado é **o que perguntar**:

| Obter | De quem | Destrava |
|---|---|---|
| Piso mensal + fee por transação da custódia, nas duas alternativas | Fireblocks e BitGo | §14.3 — e a ordem de contratação |
| Bps do anchor no rail BR, e o teto de partner fee | fornecedor | se a integração é custo ou receita líquida |
| Preço por envelope, por transação PIX e por consulta de screening | DocuSign, PSP, fornecedor de screening | a fórmula do deságio (PRD §3.4) |
| Piso do plano de Neon com a janela de PITR necessária | Neon | o RPO da §10.5 deixa de ser "a confirmar" |
| Custo de observabilidade e de plantão nas duas alternativas — fornecedor tier-1 versus stack própria | Datadog/equivalente, e o time | se o alerta da §11.2 tem destino pago ou construído, e quanto pesa no run-rate da fase 01 |

### 10.4 Pipeline

`prebuild` (lint de auth-guard, bloqueia deploy em regressão) → `next build` → runtime Fluid
Compute em `gru1`. Cutover de mainnet por **Rolling Releases** (10% → 50% → 100%) com as
flags no Edge Config, permitindo desligar trilha sem novo deploy. Rollback ≤ 5 min via flag.

### 10.5 Continuidade e recuperação de desastre

| Componente | Perda tolerada (RPO) | Volta em (RTO) | Mecanismo |
|---|---|---|---|
| Estado on-chain | **zero** | — | Horizon é a fonte da verdade; não há o que restaurar |
| Postgres (Neon) | minutos | minutos | point-in-time recovery; janela real depende do plano contratado — **confirmar e registrar** |
| Blob (prospecto, contratos, comprovantes) | zero | minutos | documento assinado é registro do fundo; retenção e versionamento explícitos |
| Aplicação | zero | minutos | redeploy ou rollback por flag (§10.4) |
| Material de chave | **não se aplica** | — | não se restaura de backup de banco; ver abaixo |

Que o estado on-chain tenha RPO zero não é sorte de plataforma — é o princípio 1 pagando
dividendo. Um banco perdido se reprojeta a partir do Horizon; o inverso não vale.

#### O material de chave do issuer

Este é o único ponto do documento sem caminho de volta, e por isso ele fica escrito com todas
as letras.

Perder ou comprometer a chave do issuer significa que o fundo **não consegue mais emitir,
autorizar trustline nem revogar**. A precisão importa: os tokens já emitidos continuam
existindo nas contas dos investidores e transferíveis conforme as flags do ativo. O que morre é
a capacidade de operar o fundo sobre eles — inclusive o clawback das 4 hipóteses, que é
obrigação regulatória. Não é um incidente com SEV; é evento de encerramento.

O desenho que a arquitetura assume:

- **Issuer é multisig nativo Stellar**, nunca signatário único em mainnet. Threshold e número
  de signatários são a decisão pendente §14.10 — o que já está decidido é que **um só, não**.
- **Signatários em custódias distintas.** Concentrar todos no mesmo fornecedor troca "perder a
  chave" por "perder a conta no fornecedor", que é o mesmo risco com outro nome.
- **Issuer e distributor com chaves separadas.** O distributor opera todo dia e tem raio de
  explosão maior; o issuer assina raramente e pode viver com atrito muito mais alto.
- **Recovery kit gerado, guardado offline em dois locais físicos distintos, e testado.**
  Testado significa restaurar de fato, em testnet, antes da mainnet — kit de recuperação nunca
  exercitado é uma suposição, não um controle.
- **O drill entra no calendário**, com periodicidade definida e resultado registrado. Backup
  que ninguém restaurou não conta como backup.

**A escolha de custodiante não é uma porta de mão única — a topologia é.** Signatário Stellar
rotaciona por `setOptions`: acrescenta-se a chave do custodiante como signatário, remove-se a
antiga, ajusta-se o threshold. Sem reemissão de ativo, sem migração de holder, sem downtime. É
esse fato que torna seguro entrar na fase 01 com guarda própria e decidir custodiante na fase
02 (§2.2) — a fase 02 não herda uma decisão, herda uma conta cujos signatários se trocam.

O que **não** fica barato adiando é o recovery kit acima. Guarda própria concentra em nós
exatamente o ônus que um fornecedor absorveria, e o kit deixa de ser boa prática para virar o
controle. Ele entra na fase 01, junto com a topologia — não depois dela.

O comportamento fail-closed da §10.1 já cobre a metade fácil: sem topologia de assinatura
válida, mainnet não assina. Ele não cobre a metade difícil, que é ter para onde voltar.

---

## 11. Observabilidade, operação e testes

### 11.1 O que instrumentar

OpenTelemetry com `withSpan(name, attrs, fn)`. Toda chamada externa vira span: Horizon,
anchor, custódia, DocuSign, PSP, administradora. Todo response carrega `x-request-id`, que
correlaciona log, span e `EventoAudit`.

**Métricas de funil saem da trilha, não de um SDK de analytics.** Na fase 01 o spread de
originação é a receita e a conversão de `/vender` e `/comprar` determina se o capital próprio
gira — medir isso deixou de ser desejável e virou instrumento de gestão. Hoje existe só
`@vercel/analytics` (pageview), embora `LeadVendedor` e `LeadComprador` já carreguem
`utmSource`/`utmMedium`/`utmCampaign`: a atribuição de entrada existe e ninguém mede os passos.

Não é preciso fornecedor novo. **Cada etapa do funil já é uma transição de estado que grava
`EventoAudit`** (princípio 6), então conversão por etapa, drop-off e tempo entre etapas são uma
*view* sobre a trilha. Isso evita SDK no cliente, evita um contrato novo, e evita mandar
comportamento de cedente e comprador para fora do país — que seria problema de LGPD (§9.8)
criado para resolver um problema de produto.

### 11.2 Alertas

Hoje existe alarme de saldo. O alvo cobre as falhas que passam despercebidas:

| Alerta | Condição | Severidade |
|---|---|---|
| Saldo de issuer/distributor/funder | abaixo do floor | SEV2 |
| Webhook falhando | assinatura inválida, ou evento sem `processadoEm` além do limiar (§11.5) | SEV2 |
| Cron não executou | janela esperada sem execução (NAV, reservas, estoque) | SEV2 |
| NAV reprovado no gate | snapshot do dia não publicado por falha de sanidade (§8.2) | SEV2, ou SEV1 nos dois critérios duros |
| Operação parada no meio | estado intermediário além do prazo declarado (§6.8) | SEV2 |
| KYC/KYB travado | cliente em `in_progress` além do SLA (§11.5) | SEV3 |
| Ordem de saída sem transação | off-ramp criado sem XDR — a falha silenciosa da §7.1 do plano de migração | SEV1 |
| Divergência Horizon × Postgres | saldo espelhado diverge do on-chain | SEV1 |
| Falha de assinatura em mainnet | custódia recusando | SEV1 |

**O canal de alerta é separado do canal transacional, e falha ruidosamente.** Hoje os dois são o
mesmo: SMTP via nodemailer, e `lib/email/transporter.ts` **devolve `null` sem erro** quando o
SMTP não está configurado — *"best-effort, vira no-op"*. Para e-mail transacional é decisão
razoável. Para o canal que carrega "falha de assinatura em mainnet" e "divergência Horizon ×
Postgres" é o mesmo que não ter alerta, e o modo de descobrir é um incidente que ninguém soube
que aconteceu.

No alvo: **destino de alerta ausente em produção quebra o boot**, no mesmo espírito do princípio
3, e falha de envio de alerta é ela própria um alerta, por um segundo caminho. O destino nomeado
e o escalonamento por severidade dependem da decisão de quem atende incidente
([`DECISOES-CEO.md` §9](./DECISOES-CEO.md)) — mas a separação dos canais não depende de ninguém
e entra antes.

> **Divergência a resolver de passagem:** o PRD F-M1-7 nomeia **Resend** e o código usa
> **nodemailer/SMTP**. Um dos dois está errado desde maio, e o fornecedor de e-mail não aparece
> em nenhuma tabela de stack ou de custo deste documento.

Severidades e procedimento em [`runbooks/incident.md`](./runbooks/incident.md).

### 11.3 Reconciliação

O princípio "DB depois da chain" só se sustenta se alguém verificar. Job periódico, **por asset
code** (`PLINARFS` e `PLINARFB` têm supply e tesouraria próprios), comparando:

| Confronto | Divergência significa |
|---|---|
| Σ `HoldingPLINARF` × saldos por conta no Horizon | espelho de posição atrás da chain, ou emissão fora do fluxo |
| supply (Horizon) − saldo do distributor × circulante usado no NAV (§8.2) | o denominador do preço está errado — é o defeito que a §8.2 corrige |
| caixa do razão `MovimentoFundo` × movimento efetivo de PIX e on-chain do período | lançamento faltando, duplicado, ou dinheiro que se moveu fora do razão |
| toda trustline de `PLINARFS`/`PLINARFB` com `is_clawback_enabled` — **SEV1** | há holder fora das 4 hipóteses, e nenhuma tela mostra isso (§8.1) |
| flags e topologia de assinatura do emissor do ativo-ponte × perfil registrado no cutover | o risco do caixa do fundo mudou sem aviso (§8.1) |

Divergência gera alerta, **nunca correção automática silenciosa** — e a diferença entre supply,
circulante e tesouraria é informação a publicar, não ruído a normalizar.

### 11.4 Testes

| Camada | Ferramenta | Cobre |
|---|---|---|
| Unit | Vitest | serviços, cálculo de NAV, parsers de XDR, hash de auditoria |
| Integração | Vitest | rotas com Prisma, guards de auth, idempotência |
| E2E | Playwright (+ stub de Privy) | wizards de ponta a ponta, `workers=1` para não competir no Neon |
| Contrato | scripts de smoke | anchor em sandbox, Stellar, trilha de auditoria |
| Webhook | 🆕 replay de payload assinado | dedupe, assinatura inválida, entrega duplicada, fora de ordem |

**Invariantes que precisam de teste dedicado**, porque falham em silêncio:

- rota mutante sem guard de auth → o lint de `prebuild` já barra; manter allowlist justificada
- clawback executado com aprovação única, ou com solicitante entre os aprovadores
- rota **ou Server Action** que move valor sem classificação de cutover (§6.7)
- operação de várias pernas que falha no meio e não deixa estado intermediário persistido (§6.8)
- NAV ancorado com o gate de sanidade reprovado, ou `NavSnapshot` corrigido por `UPDATE` (§8.2)
- NAV/token calculado com denominador vindo do Postgres em vez do circulante do Horizon (§8.2) —
  o teste que pega é o **pool em runoff**: toda cota realizada, caixa positivo, tokens em
  circulação, e o preço tem de ser maior que zero
- movimento de dinheiro sem lançamento correspondente em `MovimentoFundo`, e lançamento sem
  `referenciaExterna` — resgate pago que não reduz o caixa do NAV é o caso concreto
- cálculo de NAV, gate ou reconciliação escritos no singular, passando com uma classe e quebrando
  com `PLINARFS` + `PLINARFB` simultâneos
- trustline autorizada sem `is_clawback_enabled` (§8.1) — o teste que pega é **inverter a ordem**
  `changeTrust` / `configureIssuerFlags` em testnet e exigir que a autorização recuse
- emissão calculada a partir de `toAmount` (TESOURO) em vez de `fromAmount ÷ NAV` (§8.2) — o
  teste que pega é NAV/token ≠ 1,00 com cotação de ponte ≠ 1,00, onde as duas pernas do swap
  **não** podem ter o mesmo valor; e incorporação de cota que produza qualquer operação Stellar
- `memo.text` montado a partir de string acentuada de 28 caracteres (§8.1)
- `STELLAR_*_SECRET` referenciado fora de `lib/stellar/signer.ts` (§7.1) — lint de `prebuild`
- `EventoAudit` gravado com `operadorId` nulo em ação administrativa
- XDR expirado submetido sem tentativa de renovação

### 11.5 Os números que faltam

Este documento não tem um único SLO, volume-alvo ou orçamento de latência. Isso torna várias
decisões **infalsificáveis**: Postgres como cache do Horizon está certo para qual volume?
Reconciliação diária basta, ou precisa ser horária? Um cron de NAV às 18:00 é suficiente com
quantas cotas ativas? Sem grandeza, essas são preferências, não escolhas.

A resposta não é inventar valores — é aplicar o mesmo tratamento da §9.6 e registrar como
premissa a levantar, com dono.

**Grandezas a obter antes da mainnet**

| Grandeza | O que ela decide | Quem responde |
|---|---|---|
| AUM e nº de cotas ativas no cutover | frequência de NAV e de reconciliação, alerta de concentração | CEO — §14.9 |
| Investidores ativos e operações por dia | rate-limits, dimensionamento de Neon e Upstash | CEO — §14.9 |
| Tempo de processamento do KYC no anchor | o SLA do alerta "KYC travado" e a UI de espera da §2.3 | fornecedor |
| Tempo entre PIX submetido e confirmação do PSP | o prazo de cada estado intermediário da §6.8 | fornecedor |
| Janela de PITR do plano de Neon | o RPO da §10.5 | plano contratado |
| Latência p95 dos wizards | orçamento de chamadas externas por passo | **medir**, não perguntar |

A última linha é a regra geral: a instrumentação da §11.1 já produz esses spans. Latência,
taxa de erro e volume real **vêm da produção**, e por isso não entram aqui como meta chutada.
O que precisa de resposta agora é só o que vem de fora — negócio e fornecedor.

**Registro de placeholders.** Todo número ainda indefinido no documento, num lugar só, para
que nenhum vire constante esquecida no código:

| Placeholder | Onde | Enquanto não houver |
|---|---|---|
| banda de variação diária do NAV | §8.2 | gate roda em modo observação |
| prazo de cada estado intermediário de saga | §6.8 | sem alerta de operação parada |
| limiar de webhook não processado, e SLA de KYC travado | §11.2 | alerta não configurável |
| prazos de retenção por categoria | §9.8 | retenção indefinida por omissão |
| threshold e nº de signatários do issuer | §10.5 | não há mainnet |

**Nenhum deles vira constante no código.** Todos são parâmetro de `ParametrosPool`,
configuração ou flag — pelo mesmo motivo do ativo-ponte na §8.1: valor que muda com a
operação não pertence ao build.

---

## 12. Internacionalização

M4 não é "traduzir a landing" — é abrir a trilha do investidor internacional. Isso torna o
i18n um problema de arquitetura: decide URL, cache, conteúdo gerado e documento jurídico.

### 12.1 O que já existe

A base está correta e deve ser preservada: cookie `plina_locale` resolvido no `proxy.ts` a
partir de `Accept-Language`, propagado por header `x-plina-locale`, lido por `getDictionary()`
no Server Component, distribuído como props para os componentes, com `<html lang>` correto e
seletor de idioma via Server Action.

Os limites também são claros:

| Limite | Consequência |
|---|---|
| `proxy.ts` tem `matcher: ['/']` | só a landing é bilíngue |
| `Dictionary` é modelado na landing (`Caminho`, `Principio`, `Membro`) | não escala para wizards |
| `getDictionary()` usa `headers()` — server-only | os wizards (`/investir`, `/vender`, `/sacar`) são client components e não têm como consumir |
| idioma não aparece na URL | sem hreflang, sem link compartilhável por idioma, uma URL indexada em duas línguas |
| `DEFAULT_LOCALE = 'en'` em `cookie.ts`, mas `getLocale()` cai em `'pt-BR'` | dois defaults conflitantes no mesmo módulo — resolvido em favor de pt-BR pela §12.2 |

### 12.2 Estratégia de URL — híbrido

A decisão central. O alvo segue o mesmo princípio de fricção assimétrica que rege o produto:

| Superfície | Estratégia | Por quê |
|---|---|---|
| Páginas públicas e indexáveis — `/`, `/pool`, `/cotas`, `/compliance`, `/prospecto`, `/politica-clawback` | **prefixo só no idioma não-default** (`/pool` é pt-BR, `/en/pool` é inglês), com `hreflang` e canônico por idioma | precisam ser indexadas nas duas línguas e compartilhadas em roadshow por link direto |
| Fluxos autenticados — `/investir`, `/vender`, `/comprar`, `/sacar`, `/painel`, `/minha-posicao` | **cookie**, como hoje | ficam atrás de login, não têm valor de SEO, e prefixo aqui só acrescenta rota sem benefício |
| `/admin` | **pt-BR fixo** | operação interna; traduzir painel administrativo é custo sem retorno |

**A assimetria é deliberada: pt-BR não ganha prefixo.** `/pool` é a versão em português e
`/en/pool` a em inglês. O motivo é churn: as URLs públicas já existem, já foram indexadas e já
circularam — prefixar todo mundo obrigaria a uma camada de redirects permanentes para não
perder o que está indexado, em troca de simetria estética. Consequências que precisam estar
escritas, porque são justamente o que se esquece:

- o **canônico** de `/pool` é a versão pt-BR, não uma terceira URL neutra;
- `hreflang` declara o par (`pt-BR` → `/pool`, `en` → `/en/pool`) **nas duas páginas**;
- **`x-default` aponta para `/pool`** — é a decisão que faz o buscador servir português a quem
  não casa com nenhum dos dois;
- `/pt-BR/pool` não existe. Se aparecer, redireciona 308 para `/pool`, para não criar duplicata
  indexável do mesmo conteúdo.

**Isso resolve o default conflitante da §12.1.** Se pt-BR é o idioma sem prefixo, ele é o
default do sistema — e o `DEFAULT_LOCALE = 'en'` de `lib/i18n/cookie.ts` está errado, não o
fallback de `getLocale()`. Um default, num lugar só.

O `matcher` do `proxy.ts` passa a cobrir as rotas públicas, resolvendo prefixo → cookie →
`Accept-Language` → default, nessa ordem de precedência. URL vence cookie: um link
`/en/pool` renderiza em inglês mesmo para quem tem cookie `pt-BR`, e atualiza o cookie.

**Cache:** com prefixo, cada idioma tem sua própria URL e a CDN cacheia normalmente. Sem
prefixo nenhum, uma página pública cacheada por URL serviria o idioma errado — é o outro
motivo, além de SEO, para o prefixo existir. A rota sem prefixo continua cacheável porque
serve **sempre** pt-BR: ela não varia por `Accept-Language`, e é isso que a mantém segura.

### 12.3 Dicionários

O tipo monolítico moldado na landing dá lugar a **namespaces por superfície**, carregados
sob demanda:

```
lib/i18n/dictionaries/{pt-BR,en}/
  common.ts     navegação, botões, estados, erros
  landing.ts    o dicionário atual, migrado
  investir.ts   wizard do investidor
  vender.ts     wizard do cedente
  pool.ts       ficha técnica e NAV
  legal.ts      compliance, LGPD, política de clawback
```

Um tipo por namespace, com `en` e `pt-BR` obrigados a ter a mesma forma — divergência
quebra o typecheck, que é como se garante que nada fica sem tradução.

**Acesso do cliente:** um `LocaleProvider` no `app/layout.tsx` expõe locale e namespace aos
client components, mantendo `getDictionary()` para o servidor. Sem isso os wizards não têm
caminho, e é o que hoje bloqueia M4.

### 12.4 Além da UI

A parte que costuma ser esquecida e que, aqui, tem peso regulatório:

| Conteúdo | Regra |
|---|---|
| E-mails transacionais | no locale da `Pessoa`, persistido no cadastro — não no locale do request que disparou |
| Comprovantes e recibos PDF | idem; um investidor internacional que recebe comprovante em português perde a trilha |
| Prospecto e ficha técnica | ambas as línguas, versionadas em par |
| Termo do FIDC e documentos assinados | **versão jurídica prevalente é a pt-BR**, com tradução de cortesia identificada como tal. Não é escolha de produto |
| Mensagens de erro da API | `error.code` é a interface de máquina e permanece em inglês; a tradução acontece no cliente. O `message` nunca é apresentado ao usuário final |
| Trilha de auditoria e `EventoAudit` | pt-BR fixo — é registro, não apresentação |

### 12.5 Formatação

`Intl` com o locale ativo, nunca `'pt-BR'` cravado — hoje há `Intl.NumberFormat('pt-BR')`
espalhado em `/admin`, `/minha-posicao` e outros.

**Distinção que precisa ficar explícita:** locale formata, não converte. Um valor em reais
continua exibido em BRL para um leitor em inglês — muda o separador e a posição do símbolo,
não a moeda. Confundir os dois em um fundo com duas moedas de entrada é erro material.

Números com significado financeiro seguem em Geist Mono por regra do design system,
independentemente do idioma.

### 12.6 Idioma não é jurisdição

`Investidor.jurisdicao` governa trilha regulatória, ticket mínimo, anchor e suitability.
Locale governa apresentação. São ortogonais: um investidor brasileiro pode operar em inglês,
e um fundo americano com procurador no Brasil pode preferir português. Derivar uma coisa da
outra — gatear conteúdo por idioma ou inferir jurisdição do `Accept-Language` — é bug de
compliance, não de UX.

---

## 13. Do estado atual ao alvo

**Esta é a lista do que muda, não o cronograma.** Três documentos já descrevem filas de
trabalho — PRD §6, esta seção e `PLANO-MIGRACAO-ANCHOR` §9 — e listas paralelas divergem:
a §10 da `DOCUMENTACAO-TECNICA` afirma até hoje que rotas são públicas, semanas depois de o
código as ter protegido.

Portanto: **o sequenciamento vive no PRD §6**, onde as dependências comerciais e jurídicas
também estão. O que segue é o delta arquitetural que o alimenta, agrupado por urgência
técnica. Onde os dois divergirem, o PRD manda no *quando* e este doc manda no *o quê*.

A coluna **Fase** aplica a decisão de escopo do topo do documento. **01** é pré-requisito de
mainnet e impede operar com dinheiro real na operação privada. **02** entra com a constituição
do FIDC e a distribuição a terceiros: segue no alvo, mas não bloqueia o cutover. Onde a entrega
tem duas metades, a coluna diz qual parte é de cada fase — e é justamente aí que se erra o
sequenciamento, cortando de menos ou de mais.

| # | Entrega | Fase | Por quê |
|---|---|---|---|
| 1 | **Migração do anchor** (org + `/verification`, webhooks, KYC assíncrono, backfill da §9.5) — **e a partição `Anchor` → `Kyc` + `Ramp`** (§7.1) na mesma passada | **01** (PF) · 02 (KYB) | onboarding e KYC estão quebrados: endpoints removidos e sunset vencido em 16/08. A metade PF — cedente e comprador — é fase 01; o KYB do investidor institucional é fase 02. A partição sai quase de graça dentro de uma reescrita que já vai acontecer. **Tem prazo comercial além do técnico**: o fornecedor é quem indica a Plina ao Build Award da SCF (§2.3) |
| 2 | **Identidade + RBAC no admin** e `operador` real | **01** | princípio 7; a fase 01 é operada à mão todo dia, e é esse registro que a fase 02 vai auditar |
| 3 | **Dupla aprovação de clawback** — e, antes dela, **a verificação de que o clawback existe** (§8.1): ordem no runbook de cutover, recusa em `authorizeTrustline`, linha na reconciliação | flags e verificação **01** · fluxo 02 | as flags são fixadas na emissão e são irreversíveis, e no Stellar são **por trustline, não por ativo**: `is_clawback_enabled` não é lido em lugar nenhum do repositório, então o diferencial institucional inteiro pode não existir sem ninguém notar. O fluxo de aprovação só tem uso quando existe holder terceiro |
| 4 | **Choke point do guard de cutover + lint bloqueante** sobre rotas **e** Server Actions (§6.7) | **01** | o kill-switch cobre 3 de 46 rotas, e a mutação do painel fica fora da varredura |
| 5 | **Estados intermediários e reparo das sagas** (§6.8): enum de estado, prazo, ações de reparo em `/admin/ops` | **01** (originação) · 02 (entrada/saída) | a saga de cessão — assinatura → PIX ao cedente → incorporação — é o fluxo da fase 01, e é onde o dinheiro fica parado com obrigação jurídica já assumida |
| 6 | **NAV correto antes da primeira âncora** (§8.2), em três partes: (a) razão `MovimentoFundo`, denominador vindo do circulante do Horizon, apropriação de taxa e cálculo por asset code; (b) gate de sanidade antes de publicar; (c) **preço de emissão vindo do NAV**, com a incorporação de cota deixando de emitir | **01** | hoje o NAV/token superestima — caixa entra no numerador e os tokens da cota realizada saem do denominador — e devolve **0** com o pool em runoff, que é o número com que `liquidacao.ts:94` precifica resgate. E o passivo tem problema próprio: o token nasce por **duas réguas** (1 por real na cota, 1 por TESOURO no aporte), que divergem 15,5% na cotação de sandbox. NAV errado ancorado é irreversível, e na fase 01 a série **é** o entregável. As três partes são a mesma passada de código — separar significa mexer duas vezes no cálculo mais sensível do produto. (c) resolve de lambuja a janela de emissão sem reconciliação |
| 7 | **Topologia de assinatura do issuer + recovery kit testado em testnet** (§10.5) | **01** | é o único cenário do documento sem reparo, e independe de quem detém o token |
| 8 | Upgrade do Next + headers de segurança + auth no comprovante + **truncamento de `memo.text` por byte** | **01** | 5 achados da auditoria de 08/06, todos abertos; e o memo lança em runtime no primeiro texto acentuado (§8.1) |
| 9 | Webhooks de DocuSign/PSP + crons (NAV, reservas, estoque) | **01** | DocuSign e PSP são o motor de originação da fase 01; sem eles não há fechamento diário nem estado push |
| 10 | **Topologia de assinatura + contrato async do signer + `custodyConfigured()` por propriedade**, e o **lint que impede contornar a porta** (§7.1, §10.1, §10.5) | **01** | a chave do issuer vive em mainnet desde o primeiro dia. O guard de fail-closed hoje exige credencial de um fornecedor específico e bloquearia a guarda própria escolhida para a fase 01. A propriedade certa é verificável no ledger e não menciona fornecedor — *nenhum signatário isolado atinge o `med_threshold`*. E corrigir só o guard não basta: **cinco call-sites leem o secret do env direto** e quebram do mesmo jeito (§7.1) |
| 11 | Alertas da §11.2, reconciliação da §11.3 e os limiares da §11.5 — **começando pela separação do canal de alerta do transacional** | **01** | alerta sem número é alerta que não dispara; e o canal atual devolve `null` sem erro quando não está configurado, o que faz o SEV1 sumir em silêncio |
| 11b | **Limite por documento nas duas pontas + identidade da cota no funil de venda** (§6.4, §9.3) | **01** | `/vender` e `/comprar` são o produto da fase 01, e é onde sai dinheiro da Plina por PIX. Hoje não há chave em que apoiar o controle |
| 11c | **Métricas de funil derivadas do `EventoAudit`** (§11.1) e cron de fechamento mensal (§4.8) | **01** | a conversão do funil determina se o capital próprio gira; sai sem fornecedor novo e sem PII saindo do país |
| 11d | **Perfil do emissor do ativo-ponte**: gate contra o issuer de mainnet no cutover + checagem diária das flags (§8.1, §11.3) | **01** | o caixa do fundo está denominado num ativo cujo emissor de sandbox roda com chave única e `auth_immutable` falso — o perfil de hoje não garante o de amanhã, e ligar clawback depois torna clawbackable toda trustline criada dali em diante |
| 12 | **Ciclo de vida do dado pessoal** (§9.8): anonimização, `SolicitacaoTitular`, canal em `/lgpd` | **01** | cedente e comprador são titulares desde a primeira cessão; LGPD não espera FIDC |
| 13 | Superfície única de mutação no admin (Server Actions, §5.2) e fim de `/comprar/reserva\|reservar` | **01** | dívida estrutural no painel que opera a fase 01 |
| 14 | Screening OFAC/PEP de cedente e comprador (§2.2, `lib/integrations/screening/`) | **01** | AML/COAF é obrigação própria da Plina ao adquirir direito creditório de pessoa física — não é obrigação do fundo |
| 15 | Série histórica de NAV e `/pool/eventos` | **01** | é o track record em si |
| 16 | **Caminho de saída único** (`/sacar` linkado, resgate real) | 02 | saída inacessível = saída inexistente, mas na fase 01 não há terceiro de quem sair |
| 17 | Superfície de compliance (`/compliance`, `PrestadorRegulado`, pareceres) e prospecto | 02 | prestadores registrados e prospecto só existem com o FIDC constituído |
| 18 | i18n: namespaces + `LocaleProvider` + prefixo nas páginas públicas | 02 | pré-requisito de M4 — hoje o dicionário é server-only e os wizards são client (§12) |
| 19 | Trilha internacional (M4) e waterfall Soroban (M7) | 02 / pós | `nav_oracle.rs` saiu do alvo (§8.1); o orçamento de contrato auditado é candidato a virar garantia de saída |

---

## 14. Decisões pendentes

Cada uma trava desenho, não só implementação. As que dependem do CEO estão reunidas em
linguagem de negócio, com opções e recomendação, em [`DECISOES-CEO.md`](./DECISOES-CEO.md):

1. ~~**Anchor:** migrar o atual ou avaliar substituto?~~ · ~~**Plano B de parceiro de PIX?**~~
   **Resolvidos: manter o Etherfuse, por razão estratégica** — a Plina será indicada por eles ao
   **Build Award da SCF** (§2.3). Com isso a pergunta "abrimos avaliação de alternativa em
   paralelo?" fica encerrada e **saiu do [`DECISOES-CEO.md`](./DECISOES-CEO.md)**, que é lista de
   pedidos vivos ao CEO; o registro permanente é este. Seguem abertas, como perguntas comerciais
   ao fornecedor e não como decisões: **data, preço e compromisso de disponibilidade do rail BRL**
   — que datam a fase 02, não a 01 — e **se a indicação traz expectativa de contrapartida**
   (atividade em mainnet, repositório público, suporte a SEP, prazo). Se trouxer, parte disso é
   requisito de arquitetura e entra no sequenciamento.
2. ~~**KYC hosted ou programático?**~~ **Resolvido: híbrido** — pré-preenche por API, lança `/idv` para e-mail, selfie e agreement, que não têm API (§2.3). Em aberto: o prazo de KYB do investidor institucional cabe no funil do roadshow?
3. **Custódia — três opções, e a decisão é de fase 02.** Fireblocks, custodiante equivalente
   (BitGo e similares) ou **guarda própria com multisig nativo Stellar**. As três estão em
   [`DECISOES-CEO.md` §2](./DECISOES-CEO.md); este documento estava atrasado, listando duas.
   Para a **fase 01 a arquitetura assume guarda própria** (§2.2): não há terceiro detendo token
   e o auditor que poderia exigir custodiante qualificado é fase 02, então pagar o piso do
   fornecedor mais caro da categoria agora é comprar sinal de compliance sem plateia (§10.3).
   O que decide na fase 02 é a exigência real do auditor do FIDC, não a suposição sobre ela —
   e a troca é rotação de signatário, não migração (§10.5).
4. **Qualificação dos aprovadores de clawback:** quem, nominalmente, ocupa `APROVADOR` — e a política exige que um deles seja do jurídico? É registro em `AprovacaoClawback.papel` e regra de runbook, não gate de código (§5.3).
5. **Yield-alvo da Sênior** (`spread_curva_yield_pool`) — provisório em `CDI+5%` / `SOFR+7%`, nunca fixado. Não implementar antes da confirmação do CEO (ver [`2026-06-30-spread-cdi-provisorio.md`](./2026-06-30-spread-cdi-provisorio.md)). **Também trava a provisão de performance no NAV** (§8.2): sem benchmark fixado não há excedente a calcular, e o NAV segue líquido só de administração.
6. ~~**Soft-launch sem FIDC formal?**~~ **Resolvido em 2026-08-18: sim.** A fase 01 opera sob
   a Lei 11.795/2008 sem FIDC, e ninguém além da Plina detém PLINA-RF — decisão, alternativas
   recusadas e gatilhos de reversão no [Escopo](#decisão-de-escopo--quem-detém-plina-rf-na-fase-01).
   Em aberto, e é do CEO: a estrutura do seed (equity na Plina ou compra de token) e a
   existência de LOI que precise alocar antes da constituição do fundo. O PRD §8.1 e o
   `DECISOES-CEO.md` ainda registram isso como pendente e precisam ser atualizados.
7. **Banda de variação diária do NAV** (`ParametrosPool.bandaVariacaoNavPct`): qual variação
   entre snapshots é normal e qual é sinal de erro de cálculo? Depende do perfil de prazo e
   inadimplência da carteira, que só a operação revela. Até definir, o gate da §8.2 roda em
   modo observação — alerta sem bloquear.
8. **Prazos de retenção por categoria de dado** (§9.8), e a confirmação de que retenção
   regulatória prevalece sobre pedido de eliminação enquanto o prazo correr. É decisão de
   jurídico e DPO, não de engenharia — mas trava o `/lgpd`, a anonimização e a resposta ao
   primeiro titular que perguntar.
9. **Volume-alvo no cutover**: AUM, número de cotas ativas, investidores e operações por dia
   (§11.5). Sem isso, frequência de NAV, de reconciliação e dimensionamento de infraestrutura
   são chute. Vem do CEO e do resultado do outreach institucional.
10. **Topologia de assinatura do issuer** (§10.5): quantos signatários, qual threshold, em
    quantas custódias distintas. Já decidido que signatário único em mainnet está fora; falta
    o desenho, e ele depende parcialmente da decisão 3.
11. **Convenções de apropriação de taxa** (§8.2): base de dias, base de incidência e regra de
    cristalização da performance. Recomendação da engenharia registrada na §8.2 — 252 dias
    úteis, incidência sobre o NAV líquido do dia anterior, cristalização por janela com marca
    d'água —, mas a escolha é de jurídico/estruturador e entra no regulamento do veículo.
    **Tem prazo curto por um motivo específico:** convenção só vale a partir do primeiro
    snapshot ancorado. Mudar depois não é trocar um parâmetro, é corrigir a série publicada,
    com o mesmo custo descrito na §8.2. Anda junto com a decisão 4 sobre provisão, em
    [`DECISOES-CEO.md` §4](./DECISOES-CEO.md).
12. **Onde fica o caixa realizado do fundo** (§8.1): TESOURO, que rende e mantém o veículo
    cambialmente neutro, ou fiat na conta do PSP? A engenharia recomenda **manter TESOURO** —
    o argumento de neutralidade cambial da §8.1 é bom e a alternativa troca rendimento por
    nada. O que muda é o *status*: hoje é default herdado da integração, e passa a ser escolha
    registrada, com o perfil do emissor monitorado (item 11d da §13). É decisão de CEO + CTO
    porque é exposição do patrimônio, não desenho técnico.
13. **Descope do `nav_oracle.rs` e realocação do orçamento de Soroban** (§8.1): confirmar que o
    contrato de oráculo sai, já que duplica a âncora por `memo.hash` que já existe, e decidir se
    o orçamento liberado vai para **garantia de saída** — a defesa que o holder não tem hoje
    contra `AUTH_REVOCABLE`. É decisão de CTO sobre escopo, e vale tomá-la antes de M7 entrar em
    orçamento, porque contrato auditado é o item mais caro da fila.

---

*Este documento é o alvo. Quando uma decisão da §14 for tomada, ela desce para a seção
correspondente e sai daqui.*
