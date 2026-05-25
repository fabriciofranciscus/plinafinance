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
