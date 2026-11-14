# Plina Finance — POC

**Direitos creditórios de consórcio brasileiro, tokenizados como cota de FIDC na Stellar.**

POC do hackathon. Roda em **testnet Stellar** + **Etherfuse sandbox** (anchor regulada LATAM). Demonstra um ciclo institucional completo: PIX brasileiro entra via anchor, vira PLINA-RF on-chain, e o investidor acompanha posição lida direto do Horizon.

> Whitepaper canônico: `../PlinaFinance-1.pdf` (v1.0, abril 2026).
> Política de clawback (4 hipóteses, públicas): `/politica-clawback`.

---

## Demo flow (o fluxo único da POC)

`/investir` é a tela que prova a tese end-to-end:

1. **Login Privy** → wallet Stellar embedded criada (Tier 2, `rawSign` Ed25519).
2. **KYC mock + trustline PLINA-RF** autorizada pelo issuer (`AUTH_REQUIRED`).
3. **Quote BRL → TESOURO** via Etherfuse sandbox (REST real, não mock).
4. **Onramp PIX → TESOURO** (com `pollOnRampUntilTerminal` para os 3–10s de indexing).
5. **Swap TESOURO → PLINA-RF** via distributor (preço NAV do pool).
6. **`/minha-posicao`** lê o balance direto do Horizon — Postgres é só cache.
7. **`/admin`** registra liquidação → resgate + offramp Etherfuse fecha o ciclo.

---

## Stack

- **Next.js 16.2.4 + React 19.2.4** — App Router, Server Actions. _Não é o Next.js da sua training data — leia `node_modules/next/dist/docs/` antes de assumir APIs antigas._
- **Stellar testnet** via `@stellar/stellar-sdk` 13 — issuer com `AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED`.
- **Privy** (`@privy-io/react-auth` + `@privy-io/server-auth`) — wallet embedded Stellar do investidor.
- **Etherfuse sandbox** (`api.sand.etherfuse.com`) — anchor LATAM regulada, asset bridge **TESOURO**, rail **PIX (BRL)**. SDK vendorado em `lib/anchors/etherfuse/` (4 patches `PLINA-MOD-NNN` documentados em `lib/anchors/README.md`).
- **Prisma + Neon Postgres** — duas connection strings: pooled (`DATABASE_URL`) + direct (`DIRECT_URL`).
- **Tailwind v4** (config-less, tokens em `app/globals.css`).

Arquitetura: hexagonal-lite. Services consomem a interface `Anchor` (`lib/anchors/types.ts`), nunca classes concretas. Trocar provider = 1 linha em `lib/adapters/index.ts`.

---

## Quickstart

```bash
npm install
cp .env.local.example .env.local   # preencher os secrets abaixo
npm run prisma:migrate              # cria schema no Neon
npm run prisma:seed                 # cota mock incorporada + investidor de teste
npm run dev                         # http://localhost:3000
```

### Env vars obrigatórias (`.env.local`)

```env
# Banco
DATABASE_URL=               # Neon pooled
DIRECT_URL=                 # Neon direct (migrations)

# Stellar testnet
STELLAR_NETWORK=testnet
STELLAR_ISSUER_SECRET=      # testnet — flags AUTH_* habilitadas
STELLAR_DISTRIBUTOR_SECRET= # testnet

# Privy (dashboard.privy.io, free tier 1000 MAUs)
PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Etherfuse (devnet.etherfuse.com → Ramp → API Keys)
ETHERFUSE_API_KEY=
ETHERFUSE_ENV=sandbox

# Admin POC
ADMIN_PASSWORD=             # painel da operação

# Lead capture landing
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
LEAD_EMAIL_TO=
```

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
(source = the distributor you passed), that the distributor is listed in `ACCOUNTS` of the public `stellar.toml`, that the NAV
is recomputed from the file, and that circulating supply and trustline totals match Horizon.

Exit codes: `0` CONFERIDO · `1` REPROVADO (a check failed) · `2` NÃO CONFERIDO (nothing failed, but something could not be checked, e.g. balances that changed after the snapshot).

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
Read-only, testnet only (it refuses `PUBLIC`). Exit: `0` every step checks out · `2` checks out but a step is pending · `1` a step is not proven.

**This one cannot be run from the outside:** it reads Plina's database and private Blob (it needs the project's `DATABASE_URL`,
`BLOB_READ_WRITE_TOKEN` and the issuer configuration). The operators run it and publish the output (`exports/evidencia-cota-<cotaId>.md` and `.json`,
no personal data). What a reviewer can do **without** access is re-check each row of that published table against the chain:

```bash
# 1. the SHA-256 of the published document:
sha256sum <document>
# 2. the Memo.hash of the anchoring transaction (hex); it must be the same value, and successful must be True:
curl -s https://horizon-testnet.stellar.org/transactions/<txHash> | python3 -c \
  'import sys,json,base64;t=json.load(sys.stdin);print(t["successful"],t["memo_type"],base64.b64decode(t["memo"]).hex())'
```

Worked example with a real artifact (a Pix settlement receipt from the Asaas sandbox, anchored on testnet; the file `comprovante-pix-4274834b.json` is in the evidence package):
`sha256sum comprovante-pix-4274834b.json` gives `32417ce2fe08bea91585a1b337ccd5e0c35fe5bfb45f53055ec10b473bedd48a`, and tx
[`eb7306d1…dbcd`](https://stellar.expert/explorer/testnet/tx/eb7306d1995224bc5b9649f7559899eb195542eb5d9d7eeb6ba8bc446271dbcd)
shows `True hash 32417ce2…d48a`. (That receipt is a sandbox smoke, separate from the proof quota, whose settlement is a simulated Pix.)

## Smoke tests (rodar antes de gravar a demo)

```bash
npm run smoke:stellar     # cria contas testnet, trustline, emite PLINA-RF, autoriza, faz clawback
npm run smoke:etherfuse   # quote BRL→TESOURO, customer, bank account, on-ramp order
npm run smoke:audit       # audit log append-only
```

Saídas verdes ficam em `smoke-stellar-output.json` e `smoke-etherfuse-output.json`.

```bash
npm run typecheck         # tsc --noEmit
npm run build             # next build (inclui Prisma generate)
npm run test:e2e          # Playwright (19 specs)
```

---

## Rotas principais

| Rota | Audiência | O que faz |
|---|---|---|
| `/` | Investidor institucional | Tese + lead capture (SMTP) |
| `/pool` | Público | NAV + supply PLINA-RF lidos do Horizon, link Stellar Expert |
| `/politica-clawback` | Público | 4 hipóteses de clawback (linkadas no `stellar.toml`) |
| `/investir` | Investidor | **Fluxo principal da POC** — Privy + Etherfuse + emissão |
| `/minha-posicao` | Investidor | Saldo on-chain + yield projetado + liquidação |
| `/cotas` / `/cessao/[id]` | Público | Cotas no pool + comprovante de cessão |
| `/comprar` / `/vender` | Caminho A | Funil comprador-usuário (revenda 30–90d) e vendedor |
| `/admin` | Operação | Pipeline vendedor + comprador, incorporação, validação, clawback |
| `/lab` | Dev | Playground das primitivas Stellar |

---

## Estrutura

```
app/                  # rotas Next 16 (App Router)
  investir/           # ← fluxo principal da POC
  minha-posicao/      # ← posição on-chain do investidor
  pool/, admin/, ...
lib/
  stellar/            # wrappers @stellar/stellar-sdk
  anchors/
    types.ts          # interface Anchor (port)
    etherfuse/        # SDK vendorado de regional-starter-pack (Apache-2.0)
  wallet/privy.ts     # rawSign + reconstrução de envelope Stellar
  services/           # originacao, tokenizacao, investidor, liquidacao, ...
  db/                 # Prisma client
prisma/               # schema + seed
scripts/              # smoke tests
e2e/                  # Playwright specs
```

---

## Links

- **Whitepaper v1.0**: `../PlinaFinance-1.pdf`
- **Arquitetura**: `../ARCHITECTURE.md`
- **Plano hackathon**: `../HACKATHON_PLAN.md`
- **Specs MVP**: `../SPECS_MVP.md` + `../SPECS_MVP_TECH.md`
- **Etherfuse SDK vendorado**: `lib/anchors/README.md` (atribuição + patches `PLINA-MOD-*`)
- **Brand & voz**: `PRODUCT.md` + `DESIGN.md`

---

## Commits que evidenciam a integração com a anchor

- [`0e4b5c5`](https://github.com/fabriciofranciscus/plinafinance/commit/0e4b5c5) — fundação: Etherfuse + Privy + Neon, fluxo BRL → TESOURO → PLINA-RF
- [`1a60d43`](https://github.com/fabriciofranciscus/plinafinance/commit/1a60d43) — `/investir` end-to-end consumindo a anchor real
- [`75da658`](https://github.com/fabriciofranciscus/plinafinance/commit/75da658) — `PLINA-MOD-005`: bank account API + arquitetura iframe Etherfuse
