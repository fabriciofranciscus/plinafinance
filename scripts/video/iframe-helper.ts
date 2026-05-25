/**
 * Helper de iframe pra gravação do vídeo.
 *
 * Esse é o ÚNICO script "novo" do vídeo — todos os outros passos são curl
 * puro contra as rotas `/api/investidor/*` (que exercitam o produto Plina:
 * `lib/services/investidor.ts`, persistência no Postgres, audit log,
 * orquestração Privy + Etherfuse + Stellar).
 *
 * Por que esse helper existe:
 *   - Bank account na Etherfuse é hosted-only (SDF DevRel client.ts:75,
 *     `fiatAccountRegistration: 'hosted'`). Pra ativar, é obrigatório um
 *     iframe rodando no navegador. Não tem como contornar via API.
 *   - Helper abre o iframe via `xdg-open` (ou `open`/`start`) e faz polling
 *     em `getFiatAccounts` até detectar bank `compliant=true`.
 *
 * Fluxo:
 *   1. POST /api/investidor/onboard (Authorization: Bearer $PRIVY_TOKEN)
 *      → exercita `onboardInvestidor` em lib/services/investidor.ts:
 *        ensureStellarWallet + createCustomer + KYC programático +
 *        upsert Investidor + EventoAudit (INVESTIDOR_ONBOARDED).
 *   2. anchor.getKycUrl(customerId, publicKey) — chamada de INSTRUMENTAÇÃO,
 *      não muda estado da Plina. Devolve presignedUrl pro iframe.
 *   3. xdg-open presignedUrl.
 *   4. Polling em `/ramp/customer/{id}/bank-accounts` até compliant=true.
 *   5. Grava `scripts/video/state.json` pros próximos curls do vídeo lerem.
 *
 * Pré-condições:
 *   - `npm run dev` rodando em background (rota /api/investidor/onboard).
 *   - PRIVY_TOKEN exportado (capturado via DevTools — ver
 *     docs/video-integracao-curl-block.md).
 *
 * Rodar:  npx tsx scripts/video/iframe-helper.ts
 */

import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EtherfuseClient } from '../../lib/anchors/etherfuse';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

const STATE_PATH = join(process.cwd(), 'scripts/video/state.json');
const API_BASE = process.env.PLINA_API_BASE ?? 'http://localhost:3002';

interface OnboardResponse {
  investidorId: string;
  publicKey: string;
  etherfuseCustomerId: string;
  kycStatus: string;
  fundedNow?: boolean;
}

interface State {
  ranAt?: string;
  investidor?: {
    id: string;
    publicKey: string;
    etherfuseCustomerId: string;
    kycStatus: string;
  };
  customer?: { id: string; presignedUrl: string };
  bank?: { id: string; activatedAt: string };
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}
function saveState(s: State) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

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
  compliant?: boolean;
  status?: string;
  pixKey?: string;
  abbrClabe?: string;
  currency?: string;
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
  banner('HELPER · IFRAME ETHERFUSE');

  const token = process.env.PRIVY_TOKEN;
  if (!token) {
    throw new Error(
      'PRIVY_TOKEN não setado. Capture via DevTools (ver doc) e export PRIVY_TOKEN=...',
    );
  }

  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) throw new Error('ETHERFUSE_API_KEY ausente.');
  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  const anchor = new EtherfuseClient({ apiKey, baseUrl });

  const state = loadState();
  state.ranAt = new Date().toISOString();

  // ───── 1. POST /api/investidor/onboard (produto Plina) ─────────────────
  banner('1/4 · POST /api/investidor/onboard');
  info(`POST ${API_BASE}/api/investidor/onboard`);
  const onboardRes = await fetch(`${API_BASE}/api/investidor/onboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nome: 'Fundo Demo Video' }),
  });
  if (!onboardRes.ok) {
    const text = await onboardRes.text();
    throw new Error(`onboard falhou (${onboardRes.status}): ${text}`);
  }
  const onboard = (await onboardRes.json()) as OnboardResponse;
  ok(`investidorId = ${onboard.investidorId}`);
  ok(`publicKey = ${onboard.publicKey}`);
  ok(`etherfuseCustomerId = ${onboard.etherfuseCustomerId}`);
  ok(`kycStatus = ${onboard.kycStatus}`);
  state.investidor = {
    id: onboard.investidorId,
    publicKey: onboard.publicKey,
    etherfuseCustomerId: onboard.etherfuseCustomerId,
    kycStatus: onboard.kycStatus,
  };
  saveState(state);

  // ───── 2. Pega presignedUrl (instrumentação, não muda estado Plina) ────
  banner('2/4 · getKycUrl (instrumentação)');
  info(
    'anchor.getKycUrl: chamada utilitária do helper, não exercita produto.',
  );
  const presignedUrl = await anchor.getKycUrl(
    onboard.etherfuseCustomerId,
    onboard.publicKey,
  );
  ok(`presignedUrl recebida (${presignedUrl.length} chars)`);
  state.customer = { id: onboard.etherfuseCustomerId, presignedUrl };
  saveState(state);

  // ───── 3. Abre iframe ──────────────────────────────────────────────────
  banner('3/4 · Abre iframe no navegador');
  console.log(`\n     ${presignedUrl}\n`);
  openInBrowser(presignedUrl);
  console.log(
    '\n     Preencha bank account no iframe da Etherfuse (sandbox aceita\n' +
      '     CLABE STP). Polling /ramp/customer/.../bank-accounts a cada 3s\n' +
      '     até detectar conta com compliant=true.\n',
  );

  // ───── 4. Polling até bank ativa ───────────────────────────────────────
  banner('4/4 · Polling getFiatAccounts até compliant=true');
  const pollDeadline = Date.now() + 5 * 60_000;
  let active: RawAccount | null = null;
  let lastCount = 0;
  while (Date.now() < pollDeadline) {
    const accs = await listAccountsRaw(anchor, onboard.etherfuseCustomerId);
    if (accs.length !== lastCount) {
      info(`accounts = ${accs.length}`);
      lastCount = accs.length;
    }
    active =
      accs.find((a) => a.compliant === true) ??
      accs.find((a) => a.status === 'active') ??
      null;
    if (active) {
      ok(`bank ativa: ${active.bankAccountId}`);
      ok(`compliant = ${active.compliant} · status = ${active.status}`);
      if (active.currency) info(`currency = ${active.currency}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  if (!active) {
    warn('Timeout 5min sem bank ativa.');
    warn(
      'Caminho de produção exige iframe completo. Sem ele, /api/investidor/buy/onramp/create cai no fallback mock (PLINA-MOD-005).',
    );
    saveState(state);
    process.exit(2);
  }

  state.bank = {
    id: active.bankAccountId,
    activatedAt: new Date().toISOString(),
  };
  saveState(state);

  banner('✓ HELPER OK · estado em scripts/video/state.json');
  console.log(
    `\n     próximos passos (curl puro contra /api/investidor/*):\n` +
      `\n     export INVESTIDOR_ID=${onboard.investidorId}` +
      `\n     export PUBKEY=${onboard.publicKey}` +
      `\n     export CUSTOMER_ID=${onboard.etherfuseCustomerId}` +
      `\n     export BANK_ID=${active.bankAccountId}` +
      `\n\n     ver docs/video-integracao-curl-block.md\n`,
  );
}

main().catch((err) => {
  console.error('\n✗ HELPER FALHOU:');
  console.error(err);
  process.exit(1);
});
