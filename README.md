# Plina Finance — protótipo em rede de testes

Cotas contempladas de consórcio, representadas como tokens de demonstração na rede Stellar testnet. Fase 01: operação privada, sem oferta pública e sem FIDC nesta fase.

> **PT:** Esta é uma demonstração em rede de testes (Stellar testnet). Nenhum dinheiro real é movido, e nada aqui é oferta de valores mobiliários, promessa de rentabilidade ou garantia de liquidez.
>
> **EN:** This is a demonstration on the Stellar testnet. No real money moves, and nothing here is an offer of securities, a promise of returns, or a guarantee of liquidity.

Protótipo em rede de testes (Stellar testnet) com o sandbox da Etherfuse. Demonstra o ciclo de ponta a ponta: Pix simulado entra, vira PLINA-RF on-chain e tem saída. O Pix ao cedente usa o sandbox de um provedor de pagamento (Asaas) ou um provedor simulado; em nenhum dos dois há dinheiro real.

**Para quem avalia as entregas do Instaward 2:** comece por [Verify the Instaward 2 deliverables](#verify-the-instaward-2-deliverables). O comando principal é `pnpm smoke:ciclo`: roda o ciclo inteiro na testnet, sem `.env` e sem chave.

---

## Verify the Instaward 2 deliverables

Three commands, in the order a reviewer would use them. Everything runs on the **Stellar testnet**; nothing here needs a
production secret. Where a command cannot be run from the outside, this guide says so and shows the manual check instead.

Public accounts (from <https://plina.finance/.well-known/stellar.toml>, `ACCOUNTS` and `[[CURRENCIES]]`):

| Role | Public key |
|---|---|
| Issuer (`PLINARF`) | `GBRG4JKO7R2R3OXPTQHL6TIZ5ZVF57YXHQ3547UYMV35TSW5Y6VUZOLB` |
| Distributor | `GA5NGV3RWPN7VLI7TG7BF6IBPWVMDNAO7HIRJWD3FKFOTAAKPJYCKMXB` |

### 1. `pnpm smoke:ciclo` — the whole cycle, one command

Reproduces originate → issue → recover → invest → redeem → realize → reconcile and prints a Stellar Expert link for every
on-chain step.

```bash
git clone <this repo> && cd plina-finance
pnpm install --frozen-lockfile
pnpm smoke:ciclo
```

- **Needs:** Node 20.9+ (Next.js 16 requirement; tested on Node 24), pnpm 10, **Docker** (a throwaway Postgres 17 container is
  started and removed at the end) and internet for the testnet friendbot/Horizon. No `.env`, no keys: all accounts
  (issuer, distributor, Plina position, investor, bridge-asset issuer) are created fresh on the testnet on every run.
  Without Docker, point `SMOKE_CICLO_PG_URL` at an **empty local** Postgres (`127.0.0.1`/`localhost` only; anything else is refused).
- **Never touches** the production or dev Neon database or any project key. It refuses `STELLAR_NETWORK=PUBLIC`.
- **Expected:** about 3 minutes, exit code `0`, 7 step headers and about a dozen `https://stellar.expert/explorer/testnet/tx/<hash>` links, ending with:

```text
━━━ [1/7] ORIGINAR — cedente (KYC aprovado, CPF sintético) → lead → oferta → cessão → laudo → anuência → envio e assinatura (DocuSign simulado) → titular → Pix SIMULADO
━━━ [2/7] EMITIR — incorporar a cota (PLINARF emitido pelo issuer à posição da Plina)
━━━ [3/7] RECUPERAR — a emissão entra na rede, o banco cai antes de gravar; a reexecução acha a tx pelo memo
━━━ [4/7] INVESTIR — swap atômico TESOURO → PLINARF (investidor assina; issuer co-assina no submit)
━━━ [5/7] RESGATAR — cotação persistida; 1 tx, 2 pernas: o investidor queima PLINARF no issuer e recebe TESOURO do distributor (E2-6)
━━━ [6/7] REALIZAR — comprador reserva a cota A e a realização (Caminho A) entra no razão
━━━ [7/7] RECONCILIAR — o que o banco diz = o que a rede diz
OK — ciclo completo na testnet; banco descartável removido; 4 comprovante(s) no Blob em memória.
```

  Each leg is run **again** and the smoke fails if anything duplicates (payment, issuance, anchor, swap, redeem, realization).
  The issuance recovery is proven by injecting a database failure after the on-chain write: the rerun finds the transaction by memo and the supply does not grow.
- **What is simulated (declared):** the DocuSign API (4 network calls replaced in-process; the claim, stored bytes, SHA-256, PDF anchor and the signed transition are the real code), the bridge asset `TESOURO` (a disposable testnet asset instead of Etherfuse's), the outbound Pix (simulated PSP) and the Vercel Blob (in memory). The cedente CPF is synthetic.
- **Recorded runs:** two clean-clone runs on commit `ea3028a`, both exit `0`; their terminal output is in the evidence package (`smoke-ciclo-execucao-1-ea3028a.log` and `smoke-ciclo-execucao-2-ea3028a.log`), not in this repository.
- If it fails with `getaddrinfo`/`fetch failed`, the testnet friendbot or Horizon was unreachable: run it again.

### 2. `pnpm snapshot:verificar` — recompute the published NAV from the public file and Horizon

```bash
pnpm snapshot:verificar https://plina.finance/api/nav-snapshot/2026-11-14 \
  --issuer GBRG4JKO7R2R3OXPTQHL6TIZ5ZVF57YXHQ3547UYMV35TSW5Y6VUZOLB \
  --distributor GA5NGV3RWPN7VLI7TG7BF6IBPWVMDNAO7HIRJWD3FKFOTAAKPJYCKMXB \
  --network testnet
```

Read-only, public file plus Horizon; the accounts and network come from **your** arguments, never from the file under check.
It checks that the file is canonical JSON (RFC 8785), that the anchor transaction's `Memo.hash` equals the SHA-256 of the file
(source = the distributor you passed), that the distributor is listed in `ACCOUNTS` of the public stellar.toml, that the NAV
is recomputed from the file, and that circulating supply and trustline totals match Horizon.

Exit codes: `0` CONFERIDO · `1` REPROVADO (a check failed) · `2` NÃO CONFERIDO (nothing failed, but something could not be checked, e.g. balances that changed after the snapshot) · `64` usage error (missing or invalid arguments; nothing was checked).

Output on 2026-11-14 (abridged; real run, exit `0`):

```text
✓ sha256: SHA-256 do arquivo publicado = 7787378e35d32a038ec8f0eb5d2ba52215f41325aceb0d9f72a4ded1786780b9
✓ ancora: tx 574873a04a67c272b1f194bb735b7851f515cd282437d8b3dbd2807dfd527539 (2026-11-14T20:26:40Z): Memo.hash = SHA-256 do arquivo, source = distributor
✓ distributor-no-toml: o distributor consta em ACCOUNTS do stellar.toml de plina.finance
✓ nav-do-arquivo: NAV/token 1.00000000 = numerador 387400.0000000 ÷ denominador 387400.0000000 (NAV_DO_LEDGER)
✓ horizon-PLINARF: ... circulante 387400.0000000; Σ 18 trustlines autorizadas = 387400.0000000
! cotas-legadas: 3 LEGADO: emissão confirmada por operação de emissão, sem cadeia de hashes (...)
CONFERIDO: o Memo.hash da âncora (tx do distributor informado) é o SHA-256 do arquivo; denominador e conciliação refeitos do Horizon. O numerador (cotas e caixa) é registro contábil da Plina, publicado no arquivo; ...
```

Two limits to read together with that result: the **numerator** (quotas and cash) is Plina's accounting record, published in the file —
only the denominator and the reconciliation come from Horizon; and the three quotas in that snapshot are **legacy** (their issuance
is confirmed on-chain, but without the E1-4 hash chain), so the "0 of 3 E1-4" warning is expected for that day. A snapshot that
includes the proof quota is verified the same way; its quota is reported separately from the legacy ones.

### 3. `pnpm evidencia:cota <cotaId>` — the proof chain of one quota

Lists validation → cession → settlement → incorporation (canonical record, anchored before the issuance) → issuance, with the
document and SHA-256 of each step, and checks `sha256(stored document) == hash in the database == Memo.hash on-chain`.
Read-only, testnet only (it refuses `PUBLIC`). Exit: `0` every step checks out · `1` a step is not proven (a missing artifact counts as a failure, not as pending).

**This one cannot be run from the outside:** it reads Plina's database and private Blob (it needs the project's `DATABASE_URL`,
`BLOB_READ_WRITE_TOKEN` and `STELLAR_ISSUER_PUBLIC`, a public key; no signing secret). The operators run it and publish the output (`exports/evidencia-cota-<cotaId>.md` and `.json`,
no personal data). What a reviewer can do **without** access is re-check each row of that published table against the chain:

```bash
# 1. the SHA-256 of the published document:
sha256sum <document>
# 2. the Memo.hash of the anchoring transaction (hex); it must be the same value, and successful must be True:
curl -s https://horizon-testnet.stellar.org/transactions/<txHash> | python3 -c \
  'import sys,json,base64;t=json.load(sys.stdin);print(t["successful"],t["memo_type"],base64.b64decode(t["memo"]).hex())'
```

Worked example with a real artifact (a Pix settlement receipt from the Asaas sandbox, anchored on testnet; the receipt JSON file is in the evidence package, not in this repository):
`sha256sum` of that file gives `32417ce2fe08bea91585a1b337ccd5e0c35fe5bfb45f53055ec10b473bedd48a`, and tx
[`eb7306d1…dbcd`](https://stellar.expert/explorer/testnet/tx/eb7306d1995224bc5b9649f7559899eb195542eb5d9d7eeb6ba8bc446271dbcd)
shows `True hash 32417ce2…d48a`. (That receipt is a sandbox smoke, separate from the proof quota, whose settlement is a simulated Pix.)

---

## Quickstart (desenvolvimento local)

```bash
pnpm install
cp .env.example .env.local         # preencher os valores (ver abaixo); nunca versionar o .env.local
pnpm prisma:migrate                # cria o schema no Postgres (Neon ou local)
pnpm prisma:seed                   # cotas de demonstração, emitidas de verdade na testnet
pnpm dev                           # http://localhost:3000
```

Requisitos: Node 20.9+ (requisito do Next.js 16), pnpm 10 e, para `smoke:ciclo` e para os testes com banco real, Docker ou um Postgres local vazio.

`.env.example` lista as principais variáveis; as opcionais de URL (`STELLAR_HORIZON_URL`, `ETHERFUSE_BASE_URL`) ficam **comentadas** de propósito (vazias, quebram o app). Os grupos que o app local precisa:

| Grupo | Variáveis (nomes) | Observação |
|---|---|---|
| Banco | `DATABASE_URL`, `DIRECT_URL` | Postgres; no Neon, a primeira é a conexão com pool e a segunda a direta (migrations) |
| Stellar | `STELLAR_NETWORK=TESTNET`, `STELLAR_ISSUER_SECRET`, `STELLAR_DISTRIBUTOR_SECRET` | só testnet; `STELLAR_NETWORK=PUBLIC` (mainnet) é recusado pelos scripts e pelo Pix de saída |
| Login | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID` | Privy (carteira Stellar embutida do investidor) |
| Rampa | `ETHERFUSE_ENV=sandbox`, `ETHERFUSE_API_KEY` | Etherfuse, só sandbox |
| Operação | `ADMIN_PASSWORD`, `TITULAR_HMAC_SECRET`, `OPS_CRON_SECRET` | painel `/admin`, conferência do titular e rotas de operação |
| Pix de saída | `PSP_PROVIDER` (`SIMULADO` ou `ASAAS`), `PIX_MAX_BRL`, `ASAAS_API_KEY` | `ASAAS` só fala com o sandbox (a base é fixa no código) |
| Opcionais | e-mail (`SMTP_*`), Blob (`BLOB_READ_WRITE_TOKEN`), DocuSign (`DOCUSIGN_*`), limites (`UPSTASH_*`) | ver `.env.example` |

---

## Comandos (`package.json`)

| Comando | O que faz | Precisa de |
|---|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | servidor de desenvolvimento, build e servidor de produção do Next.js | `.env.local` |
| `pnpm typecheck` | `tsc --noEmit` | — |
| `pnpm test` / `pnpm test:watch` | Vitest. Os testes `*-pg.test.ts` só rodam com `TEST_PG_URL` apontando para um Postgres **local** vazio | — |
| `pnpm lint:auth-guard` | confere que toda rota de `app/api` tem guarda de autenticação (roda também antes do build) | — |
| `pnpm test:e2e` / `pnpm test:e2e:stub` | Playwright (specs em `e2e/`); o `:stub` roda os specs `*-full-flow`/`*-authed` com o login simulado (`E2E_STUB=1`) | navegador do Playwright |
| `pnpm prisma:generate`, `pnpm prisma:migrate`, `pnpm prisma:deploy`, `pnpm prisma:studio`, `pnpm prisma:seed` | cliente Prisma, migrations (`migrate dev` e `migrate deploy`), Prisma Studio e seed | `DATABASE_URL`, `DIRECT_URL` |

### Provas e smokes (todos em testnet)

| Comando | O que prova | Precisa de |
|---|---|---|
| **`pnpm smoke:ciclo`** | **o ciclo completo**: originar → emitir → recuperar → investir → resgatar → realizar → reconciliar, com o link do Stellar Expert de cada passo | Docker (ou `SMOKE_CICLO_PG_URL` local) e internet. Sem `.env` e sem chave |
| `pnpm snapshot:verificar <url>` | recalcula o NAV publicado a partir do arquivo público e do Horizon | internet; só leitura |
| `pnpm evidencia:cota <cotaId>` | a cadeia de prova de uma cota (validação → cessão → liquidação → incorporação → emissão) | banco e Blob do projeto: **operadores**, não dá para rodar de fora |
| `pnpm evidencia:swap <txHash>` | confere uma tx de investir/resgatar: 1 envelope bem-sucedido com as 2 pernas | internet; só leitura, sem banco e sem segredo |
| `pnpm smoke:stellar` | trilho Stellar: issuer com `AUTH_REQUIRED`, trustline, emissão de PLINA-RF, autorização e clawback | internet (friendbot); grava um JSON de saída na raiz (arquivo gerado, não versionado) |
| `pnpm evidencia:plina-rf` | empacota a saída do `smoke:stellar` num relatório | o JSON gerado pelo `pnpm smoke:stellar`; não chama a rede |
| `pnpm smoke:audit` | hash de auditoria on-chain (`Memo.hash`) para um payload de exemplo | internet e `STELLAR_DISTRIBUTOR_SECRET` (testnet) no `.env.local` |
| `pnpm smoke:etherfuse` | caminho programático no sandbox da Etherfuse: cotação, cliente, conta bancária, ordem de on-ramp | `ETHERFUSE_API_KEY` (sandbox) |
| `pnpm smoke:investidor` | cadeia do investidor com prova on-chain de cada perna (Pix → ativo-ponte → swap para PLINA-RF) | chaves do sandbox |
| `pnpm smoke:docusign <e-mail>` | DocuSign sandbox: token, envelope com minuta "TESTNET" e status; o e-mail informado recebe o envelope | `DOCUSIGN_*` |

---

## Rotas principais

| Rota | Audiência | O que faz |
|---|---|---|
| `/` | Público | Apresentação e captação de contatos |
| `/pool` | Público | NAV e supply de PLINA-RF lidos do Horizon, com link do Stellar Expert |
| `/cotas`, `/cessao/[id]/comprovante` | Público | Cotas listadas e comprovante de cessão |
| `/politica-clawback`, `/privacidade` | Público | Hipóteses de clawback (linkadas no stellar.toml) e política de privacidade |
| `/entrar`, `/painel` | Todos | Login (Privy) e hub pessoal depois do login |
| `/inicio` | Investidor | Próxima ação do investidor depois do login |
| `/investir` | Investidor | Compra: cotação, on-ramp (Pix de teste), swap para PLINA-RF |
| `/minha-posicao`, `/historico`, `/sacar` | Investidor | Saldo on-chain e valor de referência por token, histórico e saque |
| `/vender` | Cedente | Envio da cota, proposta, assinatura e acompanhamento (`/vender/minhas`, `/vender/acompanhar/[leadId]`) |
| `/comprar` | Comprador | Funil do comprador de cotas |
| `/admin` | Operação | Pipeline do cedente e do comprador, validação, pagamento ao cedente, incorporação, clawback |
| `/lab` | Dev | Bancada de testes das primitivas Privy + Stellar |

---

## Stack

- **Next.js 16.4.6 + React 19.2.8** (App Router, Server Actions); **Tailwind v4** (tokens em `app/globals.css`).
- **Stellar testnet** via `@stellar/stellar-sdk` 13: issuer com `AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED`.
- **Privy** (`@privy-io/react-auth` + `@privy-io/server-auth`): carteira Stellar embutida do investidor.
- **Etherfuse sandbox** (`api.sand.etherfuse.com`): provedor de rampa (ambiente de testes), ativo-ponte **TESOURO**, trilho Pix (BRL). SDK vendorado em `lib/anchors/etherfuse/` (patches `PLINA-MOD-NNN` documentados em `lib/anchors/README.md`).
- **Pix de saída ao cedente:** porta de PSP em `lib/integrations/psp/` com provedor simulado e **Asaas só-sandbox** (a base é fixa no código).
- **DocuSign sandbox** para a assinatura da cessão.
- **Prisma + Postgres (Neon)**: duas connection strings, com pool (`DATABASE_URL`) e direta (`DIRECT_URL`).

Arquitetura: os serviços (`lib/services/`) dependem de portas (por exemplo `lib/anchors/types.ts` e `lib/integrations/psp/types.ts`) e nunca de SDK de terceiro diretamente; o banco só é atualizado depois da confirmação na rede.

---

## Estrutura

```
app/                  # rotas Next 16 (App Router); app/api = rotas de API
components/, hooks/   # interface
lib/
  stellar/            # wrappers do @stellar/stellar-sdk
  anchors/            # porta Anchor + SDK vendorado da Etherfuse (Apache-2.0)
  integrations/       # PSP (Pix de saída), DocuSign, Blob
  services/           # originação, tokenização, investidor, liquidação, resgate, ...
  wallet/, auth/      # carteira Privy e guardas de rota
prisma/               # schema, migrations e seed
scripts/              # smokes, provas e verificadores
e2e/                  # specs do Playwright
ops/runbooks/         # procedimentos de operação (inclui o do smoke:ciclo)
```

---

## Documentação neste repositório

- `lib/anchors/README.md`: atribuição do SDK da Etherfuse e patches `PLINA-MOD-*`.
- `ops/runbooks/`: runbooks de operação (`ops/runbooks/smoke-ciclo.md`, `ops/runbooks/pix-saida-incerto.md`, `ops/runbooks/ambientes.md`, `ops/runbooks/instaward2-cutover.md`, `ops/runbooks/mainnet-cutover.md`, `ops/runbooks/incorporar-cota-timeout.md`).
- `PRODUCT.md` e `DESIGN.md`: marca, voz e sistema de design.

Histórico da integração com a Etherfuse (use `git show <hash>`): `0e4b5c5` (fundação: Etherfuse, Privy e Postgres), `1a60d43` (`/investir` de ponta a ponta) e `75da658` (`PLINA-MOD-005`: API de conta bancária).
