/**
 * Smoke estendido — Etherfuse Ramp API com iframe + order verde.
 *
 * Variante do `smoke-etherfuse.ts` que vai ALÉM da limitação hosted-only:
 * abre o iframe Etherfuse no navegador via xdg-open, espera o dev preencher
 * a chave PIX/CLABE no form hospedado, e segue pra completar uma ORDER REAL
 * (sem o caminho mock auditável que está nas rotas Next.js).
 *
 * Esse smoke é um TESTE DE INTEGRAÇÃO da anchor — não é a demo do produto
 * Plina. Para a demo do produto, use os scripts em `scripts/video/` que
 * exercitam as rotas `/api/investidor/*` (= lib/services/investidor.ts +
 * persistência DB + audit log + Privy custody).
 *
 * Fluxo:
 *   1. GET /ramp/me + Stellar friendbot
 *   2. POST /ramp/onboarding-url (customer business)
 *   3. KYC programático (identity + docs + agreements; phoneNumber, email, occupation)
 *   4. Poll KYC até approved
 *   5. xdg-open presignedUrl → preencher iframe → polling até bank ativa
 *   6. POST /ramp/quote BRL → TESOURO
 *   7. POST /ramp/order + POST /ramp/order/fiat_received (sandbox)
 *   8. Poll order até `completed`, captura stellarClaimableBalanceId
 *
 * Estado em `scripts/video/state.json` pra reaproveitar em scripts seguintes.
 *
 * Rodar:  npm run smoke:etherfuse:iframe
 */

import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EtherfuseClient } from '../lib/anchors/etherfuse';
import { createFundedAccount } from '../lib/stellar/account';
import { accountExplorerUrl } from '../lib/stellar/config';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

const STATE_PATH = join(process.cwd(), 'scripts/video/state.json');

interface State {
  ranAt?: string;
  investor?: { pubkey: string; secret: string };
  customer?: { id: string; presignedUrl: string; bankAccountId: string };
  bank?: { id: string; activatedAt: string };
  quote?: {
    id: string;
    fromAmount: string;
    toAmount: string;
    exchangeRate: string;
    expiresAt: string;
  };
  order?: {
    id: string;
    status: string;
    stellarTxHash?: string | null;
    stellarClaimableBalanceId?: string | null;
    stellarClaimTransaction?: string | null;
    amountInTokens?: string;
    completedAt?: string;
  };
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}
function saveState(s: State) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

const DUMMY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const banner = (s: string) =>
  console.log(`\n━━━ ${s} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
const ok = (s: string) => console.log(`     ✓ ${s}`);
const info = (s: string) => console.log(`     · ${s}`);
const warn = (s: string) => console.log(`     ! ${s}`);

function openInBrowser(url: string) {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
    ok(`navegador aberto via ${cmd}`);
  } catch (err) {
    warn(`não consegui abrir browser (${err}). Abra manualmente:`);
    console.log(`\n     ${url}\n`);
  }
}

interface RawAccount {
  bankAccountId: string;
  pixKey?: string;
  abbrClabe?: string;
  compliant?: boolean;
  status?: string;
}

async function listAccountsRaw(
  anchor: EtherfuseClient,
  customerId: string,
): Promise<RawAccount[]> {
  const req = (anchor as unknown as {
    request: <T>(m: string, p: string, b?: unknown) => Promise<T>;
  }).request.bind(anchor);
  const resp = await req<{ items?: RawAccount[] }>(
    'POST',
    `/ramp/customer/${customerId}/bank-accounts`,
    { pageSize: 100, pageNumber: 0 },
  );
  return resp.items ?? [];
}

async function main() {
  banner('SMOKE ESTENDIDO · ETHERFUSE IFRAME + ORDER VERDE');

  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) throw new Error('ETHERFUSE_API_KEY ausente.');
  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  const anchor = new EtherfuseClient({ apiKey, baseUrl });

  const state: State = loadState();
  state.ranAt = new Date().toISOString();

  banner('1/8 · Stellar friendbot');
  const acct = await createFundedAccount();
  state.investor = { pubkey: acct.publicKey(), secret: acct.secret() };
  ok(`investor = ${state.investor.pubkey}`);
  ok(accountExplorerUrl(state.investor.pubkey));

  banner('2/8 · POST /ramp/onboarding-url');
  const customer = await anchor.createCustomer({
    email: `smoke+${Date.now()}@plina.finance`,
    publicKey: state.investor.pubkey,
    country: 'BR',
  });
  const presignedUrl = await anchor.getKycUrl(
    customer.id,
    state.investor.pubkey,
    customer.bankAccountId,
  );
  state.customer = {
    id: customer.id,
    presignedUrl,
    bankAccountId: customer.bankAccountId!,
  };
  ok(`customer.id = ${customer.id}`);

  banner('3/8 · KYC programático');
  await anchor.submitKycIdentity(customer.id, {
    pubkey: state.investor.pubkey,
    identity: {
      id: state.investor.pubkey,
      name: { givenName: 'Plina', familyName: 'SmokeIframe' },
      dateOfBirth: '1990-01-15',
      address: {
        street: 'Av. Paulista, 1000',
        city: 'São Paulo',
        region: 'SP',
        postalCode: '01310-100',
        country: 'BR',
      },
      idNumbers: [{ value: '52998224725', type: 'CPF' }],
    },
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey: state.investor.pubkey,
    documentType: 'document',
    images: [
      { label: 'id_front', image: DUMMY_PNG },
      { label: 'id_back', image: DUMMY_PNG },
    ],
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey: state.investor.pubkey,
    documentType: 'selfie',
    images: [{ label: 'selfie', image: DUMMY_PNG }],
  });
  try {
    await anchor.acceptAgreements(presignedUrl);
    ok('agreements aceitos');
  } catch (err) {
    warn(`acceptAgreements parcial: ${err instanceof Error ? err.message : err}`);
  }

  banner('4/8 · Poll KYC approved');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const s = await anchor.getKycStatus(customer.id, state.investor.pubkey);
    if (s === 'approved') {
      ok('KYC approved');
      break;
    }
    info(`status=${s}, aguardando...`);
    await new Promise((r) => setTimeout(r, 2_000));
  }

  banner('5/8 · Iframe Etherfuse');
  console.log(`\n     ${presignedUrl}\n`);
  openInBrowser(presignedUrl);
  console.log(
    '     Preencha bank account no iframe (sandbox aceita CLABE STP).\n' +
      '     Polling /ramp/customer/.../bank-accounts a cada 3s.\n',
  );
  const pollDeadline = Date.now() + 5 * 60_000;
  let active: RawAccount | null = null;
  let last = 0;
  while (Date.now() < pollDeadline) {
    const accs = await listAccountsRaw(anchor, customer.id);
    if (accs.length !== last) {
      info(`accounts = ${accs.length}`);
      last = accs.length;
    }
    active =
      accs.find((a) => a.compliant === true) ??
      accs.find((a) => a.status === 'active') ??
      null;
    if (active) {
      ok(`bank ativa: ${active.bankAccountId}`);
      ok(`compliant = ${active.compliant} · status = ${active.status}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  if (!active) {
    warn('Timeout sem bank ativa. State parcial gravado.');
    saveState(state);
    process.exit(2);
  }
  state.bank = {
    id: active.bankAccountId,
    activatedAt: new Date().toISOString(),
  };
  saveState(state);

  banner('6/8 · POST /ramp/quote BRL → TESOURO');
  const quote = await anchor.getQuote({
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: '100',
    customerId: customer.id,
    stellarAddress: state.investor.pubkey,
  });
  ok(`quoteId = ${quote.id}`);
  ok(`toAmount = ${quote.toAmount} TESOURO @ ${quote.exchangeRate}`);
  state.quote = {
    id: quote.id,
    fromAmount: quote.fromAmount,
    toAmount: quote.toAmount,
    exchangeRate: quote.exchangeRate,
    expiresAt: quote.expiresAt,
  };
  saveState(state);

  banner('7/8 · POST /ramp/order + fiat_received');
  const order = await anchor.createOnRamp({
    customerId: customer.id,
    quoteId: quote.id,
    stellarAddress: state.investor.pubkey,
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    amount: '100',
    bankAccountId: state.bank.id,
  });
  ok(`orderId = ${order.id}`);
  await anchor.simulateFiatReceived(order.id);
  ok('fiat_received → 200');

  banner('8/8 · Poll order até completed');
  const terminal = await anchor.pollOnRampUntilTerminal(order.id, {
    intervalMs: 2_000,
    timeoutMs: 90_000,
    onTick: ({ status, notFound }) =>
      info(notFound ? 'indexing 404...' : `status=${status}`),
  });
  ok(`status final = ${terminal.status}`);

  const rawReq = (anchor as unknown as {
    request: <T>(m: string, p: string) => Promise<T>;
  }).request.bind(anchor);
  const raw = await rawReq<{
    stellarClaimableBalanceId?: string;
    stellarClaimTransaction?: string;
    amountInTokens?: string;
  }>('GET', `/ramp/order/${order.id}`);

  if (raw.stellarClaimableBalanceId) {
    ok(`stellarClaimableBalanceId = ${raw.stellarClaimableBalanceId}`);
    ok(
      `https://stellar.expert/explorer/testnet/claimable-balance/${raw.stellarClaimableBalanceId}`,
    );
  }
  if (raw.amountInTokens) ok(`amountInTokens = ${raw.amountInTokens} TESOURO`);

  state.order = {
    id: order.id,
    status: terminal.status,
    stellarTxHash: terminal.stellarTxHash ?? null,
    stellarClaimableBalanceId: raw.stellarClaimableBalanceId ?? null,
    stellarClaimTransaction: raw.stellarClaimTransaction ?? null,
    amountInTokens: raw.amountInTokens,
    completedAt: new Date().toISOString(),
  };
  saveState(state);

  banner('✓ SMOKE OK · iframe + order ponta-a-ponta na sandbox');
}

main().catch((err) => {
  console.error('\n✗ SMOKE FALHOU:');
  console.error(err);
  process.exit(1);
});
