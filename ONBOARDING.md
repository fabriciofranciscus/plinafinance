# Onboarding — Plina Finance

Documento de entrada para desenvolvedores ingressando no projeto. Cobre setup do ambiente, modelo do produto, decisões de arquitetura, convenções de código e as regras não-negociáveis que governam qualquer mudança no repositório.

A leitura integral é pré-requisito para o primeiro commit. As regras descritas aqui derivam diretamente do whitepaper e existem por razões regulatórias, jurídicas ou operacionais — não são preferências de estilo.

## Fonte de verdade

A referência canônica do produto é o whitepaper Plina Finance (v1.0, abril 2026), mantido fora do repositório e distribuído pelo time. Toda decisão de implementação deve ser rastreável a uma seção dele. Em caso de conflito entre código e whitepaper, o código é tratado como defeito, não como nova convenção.

---

## 1. Setup do ambiente local

### 1.1 Pré-requisitos

- **Node 20+** (LTS). Node 18 não roda Next 16.
- **npm** (usamos npm, não pnpm/yarn).
- **Conta Neon** (Postgres serverless) — free tier suficiente para desenvolvimento.
- **Conta Privy** (`dashboard.privy.io`) — free tier 1000 MAUs.
- **Conta Etherfuse devnet** (`devnet.etherfuse.com`) — API key obtida em Ramp → API Keys.
- **Stellar testnet** — rede pública, nada a provisionar.

### 1.2 Clone + dependências

```bash
git clone git@github.com:fabriciofranciscus/plinafinance.git
cd plinafinance
npm install
cp .env.example .env.local
```

### 1.3 Variáveis de ambiente (`.env.local`)

Lista completa no [README §Quickstart](./README.md#quickstart). Mínimo necessário para o fluxo `/investir`:

- `DATABASE_URL` + `DIRECT_URL` (Neon — duas strings distintas: pooled e direct).
- `STELLAR_NETWORK=testnet`, `STELLAR_ISSUER_SECRET`, `STELLAR_DISTRIBUTOR_SECRET` (testnet exclusivamente).
- `PRIVY_APP_ID` + `PRIVY_APP_SECRET`.
- `ETHERFUSE_API_KEY`, `ETHERFUSE_ENV=sandbox`.
- `ADMIN_PASSWORD` — senha única do painel `/admin` no POC.

`.env.local` nunca deve ser commitado. Segredos nunca aparecem em logs — apenas chaves públicas são logáveis.

### 1.4 Banco de dados

```bash
npm run prisma:migrate     # cria o schema no Neon
npm run prisma:seed        # cota mock incorporada + investidor de teste
npm run prisma:studio      # GUI para inspeção (opcional)
```

### 1.5 Smoke tests

Execução obrigatória antes de qualquer desenvolvimento:

```bash
npm run smoke:stellar      # contas testnet, trustline, emissão PLINA-RF, autorização, clawback
npm run smoke:etherfuse    # quote BRL→TESOURO, customer, bank account, on-ramp order
npm run smoke:audit        # audit log append-only
```

Resultados em `smoke-stellar-output.json` e `smoke-etherfuse-output.json`. Falha em qualquer dos três bloqueia o trabalho até que o sandbox ou a testnet correspondente seja restaurada.

### 1.6 Servidor de desenvolvimento

```bash
npm run dev    # http://localhost:3000
```

Acesso ao painel administrativo: `/admin` autenticado com `ADMIN_PASSWORD`.

---

## 2. Modelo do produto

Plina tokeniza direitos creditórios de consórcio brasileiro como cota de FIDC na Stellar. O produto opera com três personas e três funis distintos:

| Persona | Funil | Localização no app |
|---|---|---|
| **Investidor institucional** | Aquisição de PLINA-RF via onramp BRL → TESOURO + swap atômico | `/investir`, `/minha-posicao` |
| **Vendedor (cedente da cota)** | Cessão da cota à Plina mediante pagamento via PIX | `/vender`, `/admin/vendedor-pipeline` |
| **Comprador-usuário (Caminho A)** | Aquisição da cota para uso do bem (30–90 dias, yield alto) | `/comprar`, `/admin/comprador-pipeline` |

O Caminho A constitui o diferencial competitivo do produto e não deve ser comoditizado em direção ao Caminho B convencional.

A originação é operada na Fase 1 — não há autosserviço de vendedor. No POC, esse passo é simulado por mock; cotas entram no pool exclusivamente via painel da operação (`/admin`).

### 2.1 Fluxo investidor — 7 telas, swap atômico

`/investir` opera o caminho real BRL → TESOURO → PLINA-RF em sete telas guiadas (`Screen` em `app/investir/page.tsx`):

1. **welcome** — login Privy (email OTP ou OAuth Google).
2. **identity** — onboard server-side (wallet Stellar embedded, customer Etherfuse, KYC programático) e **setup one-time de trustlines** (2 assinaturas Privy: PLINA-RF + TESOURO).
3. **quote** — consulta `/api/investidor/quote`, persiste `Quote` no Postgres (UUID Etherfuse como PK; `expiresAt` da anchor; `consumedAt` single-shot).
4. **onramp** — `Etherfuse.createOnRamp`, persiste `OnRampOrder`, exibe PIX. Quando bank account PIX não está ativa em sandbox (limitação documentada em PLINA-MOD-005), entra em **caminho mock** (`__mock: true` no JSON, botão "Simular PIX pago").
5. **settling** — polling de `/api/investidor/buy/onramp/status` a cada 3s até `status=completed`. Etherfuse paga TESOURO na wallet do investor (caminho real) ou flip mock instantâneo (sandbox).
6. **confirm** — `/api/investidor/buy/swap/build` retorna envelope Stellar atômico com 2 legs (investor → distributor TESOURO + distributor → investor PLINA-RF). Distributor pré-assina server-side; investor co-assina o hash via Privy.
7. **receipt** — hashes da onramp + swap. Label diferente em mock ("Distribuição (mock sandbox) concluída").

**Propriedade de segurança crítica**: emissão de PLINA-RF é binding com `Quote.toAmount` server-side. Body não carrega `amount` em nenhuma rota do funil. Quote é consumido single-shot (`db.$transaction` com `updateMany { consumedAt: null }` + assert `count === 1`). Em produção, o envelope atômico garante que sem TESOURO real entregue, a leg PLINA-RF também falha. Doc completo em [`docs/2026-05-18-quote-binding-and-atomic-swap.md`](./docs/2026-05-18-quote-binding-and-atomic-swap.md).

---

## 3. Stack

Decisões consolidadas. Substituições requerem releitura do whitepaper e aprovação do time.

- **Next.js 16.2.4 + React 19.2.4** — App Router. Esta versão introduz quebras significativas em relação às anteriores; consulte `node_modules/next/dist/docs/` antes de assumir qualquer API. Ver também [`AGENTS.md`](./AGENTS.md).
- **Server Actions** são o mecanismo padrão de mutação. Rotas `/api` são reservadas para webhooks.
- **Tailwind v4** em modo config-less. Tokens definidos em `app/globals.css`. Não criar `tailwind.config.ts`.
- **Prisma + Neon Postgres** — duas connection strings obrigatórias: `DATABASE_URL` (pooled) e `DIRECT_URL` (migrations).
- **`@stellar/stellar-sdk` 13** — operações de issuer, distributor e asset.
- **Privy** — wallet embedded Stellar do investidor. Tier 2 não expõe `signStellarTransaction`; a assinatura é feita via `rawSign` sobre o hash da transação, com reconstrução do envelope (padrão Yalla). Implementação em `lib/wallet/privy.ts`.
- **Etherfuse sandbox** — anchor LATAM regulada, API REST proprietária (não SEPs). SDK vendorado em `lib/anchors/etherfuse/` sob licença Apache-2.0 (origem: `regional-starter-pack`).

---

## 4. Arquitetura

Padrão hexagonal-lite. Estrutura:

```
lib/
  stellar/           # wrappers @stellar/stellar-sdk (issuer, account, transactions, audit, config)
  anchors/
    types.ts         # interface Anchor (port) + AnchorCapabilities
    etherfuse/       # EtherfuseClient (vendorado; patches PLINA-MOD-NNN)
    index.ts         # factory: seleção de provider por env
  wallet/
    privy.ts         # criação de wallet embedded + signXdr via rawSign
  auth/
    admin.ts         # autenticação do painel POC
  services/          # orquestração (originacao, tokenizacao, investidor, liquidacao, realizacao, pool)
  db.ts              # Prisma client
```

**Princípio fundamental:** services consomem ports (`Anchor` e, futuramente, `Kyc`, `Cessao`, `Pix`, `Crm`), nunca classes concretas. A substituição de um adapter por outro é uma alteração de uma linha em `lib/adapters/index.ts`, controlada por variável de ambiente.

---

## 5. Regras não-negociáveis

Derivadas do whitepaper (§3 e §6.5) e do [`CLAUDE.md`](./CLAUDE.md). Violações são tratadas como defeitos críticos em review.

1. **Whitepaper é fonte de verdade.** Conflito entre código e whitepaper resolve-se corrigindo o código.
2. **Stellar é escolha funcional.** Clawback nativo, AUTH flags, USDC/EURC, anchors e SEPs compõem a tese institucional. Substituição por ERC-20 ou trilho permissionless é incompatível com o produto.
3. **Banco é atualizado exclusivamente após sucesso on-chain.** Emissão, autorização de trustline e clawback são efeitos colaterais da Stellar; o Postgres reflete o estado on-chain, jamais o inverso.
4. **Idempotência é obrigatória** em toda operação financeira (cessão, PIX, reserva, sinal, emissão, clawback).
5. **Audit log append-only** em qualquer mudança de estado relevante (`lib/stellar/audit.ts`).
6. **PII permanece off-chain.** On-chain registra apenas hashes, endereços e timestamps. Conformidade LGPD aplica-se exclusivamente à camada off-chain.
7. **Política de clawback é pública e taxativa** — quatro hipóteses: decisão judicial, sanção regulatória, fraude documental, erro operacional. Cada acionamento registra fundamento on-chain. Referência pública em `/politica-clawback`.
8. **Bridge asset da demo é TESOURO** (Tesouro Direto brasileiro via Etherfuse); rail fiat é PIX (BRL). Issuer Etherfuse testnet: `GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`.
9. **Etherfuse é a anchor do POC e do MVP.** Fase 1 mainnet adiciona Transfero, MoneyGram e anchors europeias como complemento, não substituição.
10. **Segredos nunca são logados.** Apenas chaves públicas aparecem em logs.

---

## 6. Test-Driven Development

Política do projeto, vinculante:

1. Testes precedem o código. Para cada step, os testes correspondentes são escritos antes da implementação.
2. A implementação avança até que os testes passem.
3. Testes não são alterados para forçar aprovação. Falha em teste indica defeito no código.
4. Exceção restrita: mudanças estruturais legítimas (renomeação de parâmetro, import quebrado) requerem autorização explícita antes da edição do teste.

Runners atuais:

- **Playwright** (`npm run test:e2e`) — suite e2e com cobertura de rotas públicas, contratos de API e Sprint 4.
- **Smoke tests** (`scripts/smoke-*.ts`) — executam contra Stellar testnet e Etherfuse sandbox reais.

A introdução de Vitest (unit/integration) requer alinhamento prévio com o time.

---

## 7. Step Completion Checklist

Ordem obrigatória, sem omissões, antes de marcar qualquer step como concluído:

1. Testes — todos verdes.
2. Typecheck — `npm run typecheck` sem erros.
3. Lint — eslint executado nos arquivos modificados; erros corrigidos (warnings tolerados). Re-run após `git add`.
4. Build — `npm run build` verde.
5. Commit — escopo do step (ex.: `feat(tech-002): prisma schema inicial`).
6. Atualização do implementation log do módulo, quando aplicável.

---

## 8. Gotchas operacionais

### Etherfuse sandbox

- Indexing delay de 3 a 10 segundos após o pagamento. Use `pollOnRampUntilTerminal`; a UX não deve sugerir confirmação instantânea.
- `customerId` e `bankAccountId` são persistentes por usuário, jamais escopados por sessão. Devem ser gravados no Postgres na primeira chamada e reutilizados.
- `POST /ramp/order` é singular, não plural (patch `PLINA-MOD-001`).
- `accountType: 'business'` é obrigatório no onboarding.
- Header de autenticação: `Authorization: <key>` — sem prefixo `Bearer`.
- Divergências em relação ao SDK upstream estão registradas em [`lib/anchors/README.md`](./lib/anchors/README.md) (`PLINA-MOD-001` a `PLINA-MOD-005`).
- **Bank account PIX exige iframe Etherfuse** (PLINA-MOD-005). API REST aceita CLABE (MX), não PIX. Sem iframe, `createOnRamp` retorna "Proxy account not found". O backend detecta esse erro em sandbox (`ETHERFUSE_ENV=sandbox`) e cai em caminho **mock**: `OnRampOrder` é persistida com `paymentInstructionsJson.__mock = true`, `/onramp/sandbox-pay` flipa status pra `completed` direto no DB, e `/swap/build` em mock executa `distribute()` single-shot (sem TESOURO real). Em produção, o caminho mock está desligado (`/sandbox-pay` retorna 403). Marcador `mock: true` aparece em audit log e UI receipt.

### Privy Stellar Tier 2

- A API não expõe `signStellarTransaction`. A assinatura usa `rawSign(hash)` seguida da reconstrução do envelope. Implementação canônica em `lib/wallet/privy.ts`.
- Wallet é criada via `useCreateWallet` no client, não pelo dashboard.
- Criação server-side é idempotente.
- Auto-fund da testnet ocorre no primeiro acesso.

### Next.js 16

- Sem diretório `pages/`. Toda rota vive em `app/`.
- Server Actions substituem rotas `/api` para mutações.
- APIs descontinuadas em versões anteriores não estão mais disponíveis — verificar em `node_modules/next/dist/docs/`.

### Stellar

- Valores são strings com no máximo 7 casas decimais; normalize antes de submeter.
- Trustlines precisam ser autorizadas pelo issuer (`AUTH_REQUIRED`) antes que o investidor possa receber o asset.
- `stellar.toml` é servido via route handler com CORS habilitado.

---

## 9. Convenções

### Commits

Conventional Commits, com escopo do módulo ou step:

```
feat(investidor): persistir etherfuseCustomerId pra quote idempotente
fix(buy/submit): normalizar amount pra 7 decimais (limite Stellar)
docs(readme): reescreve README focado na POC
test(e2e): playwright suite — 19 specs
```

Todo trabalho é mergeado via Pull Request para `main`. Commits diretos em `main` não são permitidos.

### Código

- Comentários são reservados para o "porquê" não-óbvio (constraint oculta, workaround de bug específico). Nomes de identificadores devem suportar a leitura do "o que".
- Abstrações antecipadas são evitadas. Três trechos similares preferíveis a uma abstração prematura.
- Validação e fallback aplicam-se apenas em bordas (input de usuário, APIs externas). Cenários impossíveis não devem ser defendidos.
- Antes de implementar nova função, verificar a existência prévia em `lib/`.

### Frontend

- A audiência de `/` é o investidor institucional. Tom e copy refletem isso — varejo não é o público.
- Princípio operacional: "fricção qualifica". Terminologia regulatória (CVM 175, FIDC, SEP-24, AUTH_CLAWBACK_ENABLED) atua como filtro, não como falha de UX.
- Referência positiva: ondo.finance. Anti-referências: linguagem fintech-retail, estética crypto-degen, SaaS genérico.
- Leitura de [`PRODUCT.md`](./PRODUCT.md) e [`DESIGN.md`](./DESIGN.md) é pré-requisito para qualquer alteração de UI.

---

## 10. Mapa de documentos

| Documento | Quando consultar |
|---|---|
| [`README.md`](./README.md) | Visão geral da POC, quickstart, demo flow. |
| [`CLAUDE.md`](./CLAUDE.md) | Regras operacionais consolidadas do projeto. |
| [`AGENTS.md`](./AGENTS.md) | Aviso de quebras de compatibilidade do Next.js 16. |
| [`PRODUCT.md`](./PRODUCT.md) | Posicionamento, audiência, voz e princípios de produto. |
| [`DESIGN.md`](./DESIGN.md) | Sistema visual, tokens, hierarquia. |
| [`docs/`](./docs/README.md) | Implementation log — histórico de decisões e trade-offs por entrega de escopo material. |
| [`lib/anchors/README.md`](./lib/anchors/README.md) | Atribuição do SDK vendorado e divergências locais (`PLINA-MOD-*`). |
| Whitepaper (v1.0, abril 2026) | Fonte de verdade do produto. Mantido fora do repositório. |

---

## 11. Ramp-up sugerido

1. Setup completo do ambiente, smoke tests verdes e execução end-to-end do fluxo `/investir` em testnet — 7 telas (welcome → identity → quote → onramp → settling → confirm → receipt), com 2 sigs Privy pra trustlines (PLINA-RF + TESOURO) + 1 sig pro envelope swap atômico. Em sandbox sem iframe Etherfuse, o caminho mock é acionado automaticamente; em produção, requer bank account PIX ativa via iframe.
2. Leitura do whitepaper, `PRODUCT.md` e `CLAUDE.md`. Dúvidas estruturais devem ser endereçadas ao time antes do primeiro PR.
3. Primeira contribuição em escopo reduzido, seguindo TDD e o Step Completion Checklist na íntegra.
4. Revisão, ajustes e merge. Escopo expande progressivamente após o primeiro ciclo concluído.

---

## 12. Referências externas

- Stellar: [`developers.stellar.org`](https://developers.stellar.org).
- Etherfuse: [`docs.etherfuse.com`](https://docs.etherfuse.com) e canal de suporte do sandbox.
- Privy: [`docs.privy.io`](https://docs.privy.io). Cobertura de Stellar Tier 2 é limitada na documentação oficial — `lib/wallet/privy.ts` é a referência canônica do projeto.
- Next.js 16: `node_modules/next/dist/docs/` é a fonte autoritativa para esta versão.
