# Anchor integrations

Framework-agnostic clients para anchors fiat ↔ Stellar usados pela Plina.

## Atribuição

Esta camada (`types.ts` + `etherfuse/`) é **vendorada** do projeto
[regional-starter-pack](https://github.com/ElliotFriend/regional-starter-pack)
de Elliot Voris (ElliotFriend), Apache-2.0. Manter atribuição em qualquer
fork ou redistribuição. Modificações específicas da Plina são
documentadas no fim deste README.

## Estrutura

```
types.ts             # Anchor interface + tipos compartilhados
etherfuse/
  client.ts          # EtherfuseClient implementa Anchor
  types.ts           # tipos da API Etherfuse
  index.ts           # exports
```

## Por que vendorar (e não dep npm)

- O repo upstream é um starter pack educacional, não publica em npm.
- Vendoring nos dá controle total — se quisermos ajustar um mapeamento
  ou adicionar uma capability flag, editamos local sem PR upstream.
- Os arquivos são framework-agnostic por design (sem imports SvelteKit,
  sem `$env`, só `@stellar/stellar-sdk`). Copiar funciona out-of-the-box.

## Uso

```ts
import { EtherfuseClient } from '@/lib/anchors/etherfuse';

const anchor = new EtherfuseClient({
  apiKey: process.env.ETHERFUSE_API_KEY!,
  baseUrl: process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
});

const customer = await anchor.createCustomer({
  email: 'investidor@example.com',
  publicKey: 'GBRG4JKO...',
});
```

## Anchor interface

Toda anchor implementa `Anchor` (definida em `types.ts`):

- `createCustomer`, `getCustomer`
- `getQuote` (onramp ou offramp resolve automático)
- `createOnRamp` / `getOnRampTransaction`
- `createOffRamp` / `getOffRampTransaction`
- `registerFiatAccount?` / `getFiatAccounts`
- `getKycUrl?` / `getKycStatus`
- `getKycRequirements?` / `submitKyc?`

`capabilities: AnchorCapabilities` permite UI condicional sem
if-else por provider (ex: `kycFlow: 'iframe' | 'form' | 'redirect'`).

## Etherfuse — anchor da POC

Stellar testnet emite **TESOURO** (Brazil Tesouro Direto tokenizado) +
CETES (Mexican Federal Treasury). Bridge asset da demo é **TESOURO via PIX**
(BRL):

```
BRL via PIX (sandbox sim) → Etherfuse → TESOURO Stellar testnet → swap → PLINARF
```

Issuer TESOURO/CETES testnet (mesmo): `GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`

Sandbox specifics:
- KYC fake auto-aprova.
- `POST /ramp/order/fiat_received` simula entrada de fiat.
- API key sem prefixo `Bearer`.

## Adicionando outra anchor

Padrão `Anchor` permite adicionar AlfredPay, BlindPay, Transfero,
SEP testanchor etc. sem mudar nada do front-end ou dos services:

1. Criar `lib/anchors/<provider>/` com `client.ts` implementando `Anchor`.
2. Adicionar ao factory de anchors (futuro `lib/server/anchor-factory.ts`).
3. Add à UI selector (quando construído).

Não é trabalho de POC — fica pra MVP/Fase 1.

## Modificações Plina vs upstream

Lista mantida atualizada conforme divergirmos. Patches estão marcados
no código com `PLINA-MOD-NNN`.

- **PLINA-MOD-001** — `createCustomer` e `getKycUrl` enviam `accountType: 'business'`
  no body de `POST /ramp/onboarding-url`. Upstream original não envia.
  Fonte: SDF DevRel `PIX_Guide.md` §4 (live-tested). Sem isso, hosted
  onboarding pode falhar silenciosamente em ambientes não-sandbox.

- **PLINA-MOD-002** — `getQuote` envia `walletAddress` no body do quote
  (não só usa pra `resolveAssetPair`). Necessário pra Etherfuse calcular
  corretamente o fee de onboarding quando a wallet ainda não existe on-chain.
  Fonte: SDF DevRel `PIX_Guide.md` §6.2.

- **PLINA-MOD-003** — Novo método `simulateCryptoReceived(orderId)` pra
  avançar off-ramp em sandbox via `POST /ramp/order/crypto_received`.
  Espelha o `simulateFiatReceived` que já existia mas só pra on-ramp.
  Fonte: SDF DevRel `PIX_Guide.md` §7.4.

- **PLINA-MOD-004** — Novo helper `pollOnRampUntilTerminal(orderId, opts)`
  trata o indexing delay de 3-10s do Etherfuse: 404 dentro da janela de
  grace = aguardar; depois = `ORDER_NOT_FOUND`. Evita falso negativo em
  polling imediatamente após `createOnRamp`.
  Fonte: SDF DevRel `Dev_Setup_Guide.md` (60 build runs).

- **PLINA-MOD-005** — Novos métodos `registerPixBankAccount(presignedUrl, account)`
  e `registerSpeiBankAccount(presignedUrl, account)` chamando
  `POST /ramp/bank-account` com presigned URL auth. Métodos **ficam no
  client** pra futura ativação, mas **API rejeita PIX hoje**.
  - Testado em smoke 2026-05-15 com body `{pixKey, pixKeyType, firstName, lastName, cpf}`
    derivado do tipo upstream `EtherfusePixAccountBody`: retornou 400 `"Json deserialize error:
    data did not match any variant of untagged enum AccountRegistration"`.
  - A OpenAPI spec da Etherfuse só documenta o shape CLABE (Mexicano).
  - O tipo upstream pra PIX era especulativo, nunca validado contra API real.
  - Conclusão arquitetural: **registro PIX + execução TED ficam no iframe
    hosted da Etherfuse**, conforme `capabilities.fiatAccountRegistration: 'hosted'`
    sinalizava desde o início. Plina white-label cobre **lead → KYC → quote**;
    iframe cobre **bank account + TED**. Webhook `bank_account_updated` é o
    hand-off pra Plina chamar `createOrder` quando a conta ficar `active +
    compliant`. Decisão consistente com o pitch: Etherfuse é anchor regulada,
    Plina não duplica camada de compliance bancário.
  - Manter métodos no código por dois motivos: (a) se Etherfuse expor PIX
    via API no futuro, é só remover o erro; (b) registerSpei funciona contra
    o sandbox e pode ser útil pra testes MX.

Quando divergirmos mais, registrar aqui com referência ao patch
correspondente (`PLINA-MOD-NNN`) pra facilitar merge futuro de bugfixes
upstream.
