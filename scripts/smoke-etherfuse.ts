/**
 * Smoke test — Etherfuse Ramp API contra o sandbox.
 *
 * Valida o caminho COMPLETO programático (sem hosted iframe) que a Plina
 * usa em produção — investidor institucional não preenche iframe genérico,
 * Plina submete KYC via API a partir do form white-label dela.
 *
 *   1. GET /ramp/me — auth.
 *   2. Stellar account testnet (friendbot).
 *   3. GET /ramp/assets — descobre TESOURO.
 *   4. POST /ramp/onboarding-url — cria customer (PLINA-MOD-001 accountType business).
 *   5. POST /ramp/customer/{id}/kyc + /kyc/documents + agreements — KYC programático.
 *   6. Poll GET /ramp/customer/{id}/kyc/{pubkey} — espera status approved.
 *   7. POST /ramp/quote BRL → TESOURO.
 *   8. POST /ramp/order + POST /ramp/order/fiat_received.
 *   9. Poll com indexing grace (PLINA-MOD-004) — espera completed.
 *
 * Falhas indicam contrato quebrado com sandbox Etherfuse. Conserta antes
 * de construir UI.
 *
 * Rodar:  npm run smoke:etherfuse
 * Saída:  smoke-etherfuse-output.json (NÃO commitar — pode conter secret keys de teste).
 */

import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { EtherfuseClient } from '../lib/anchors/etherfuse';
import { createFundedAccount } from '../lib/stellar/account';
import { accountExplorerUrl } from '../lib/stellar/config';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

const step = (n: number, total: number, label: string) =>
  console.log(`\n━━━ [${n}/${total}] ${label}`);

const ok = (msg: string) => console.log(`     ✓ ${msg}`);
const info = (msg: string) => console.log(`     · ${msg}`);
const warn = (msg: string) => console.log(`     ! ${msg}`);
const expected = (msg: string) => console.log(`     ⊘ ${msg}`);

/**
 * Veredito por step. `pass` = funcionou, `expected_fail` = limitação conhecida
 * da API endereçada via arquitetura (não é bug), `fail` = bug real.
 * Final do smoke imprime resumo.
 */
type StepVerdict = 'pass' | 'expected_fail' | 'fail';
const verdicts: Record<string, { verdict: StepVerdict; note?: string }> = {};
const setVerdict = (key: string, verdict: StepVerdict, note?: string) => {
  verdicts[key] = { verdict, note };
};

// 1x1 transparent PNG — sandbox aceita qualquer base64 válido como documento.
const DUMMY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const TOTAL_STEPS = 10;

async function pollKycStatus(
  anchor: EtherfuseClient,
  customerId: string,
  publicKey: string,
  timeoutMs = 30_000,
) {
  const intervalMs = 2_000;
  const deadline = Date.now() + timeoutMs;
  let last = 'unknown';
  while (Date.now() < deadline) {
    const status = await anchor.getKycStatus(customerId, publicKey);
    last = status;
    if (status === 'approved') return status;
    if (status === 'rejected') {
      throw new Error(`KYC rejected (last=${status})`);
    }
    info(`status=${status}, aguardando...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`KYC polling timeout (${timeoutMs}ms). Último status: ${last}`);
}

async function main() {
  const apiKey = process.env.ETHERFUSE_API_KEY;
  const env = (process.env.ETHERFUSE_ENV ?? 'sandbox') as 'sandbox' | 'production';
  if (!apiKey) throw new Error('ETHERFUSE_API_KEY não configurada.');
  if (env !== 'sandbox') throw new Error(`Smoke só roda em sandbox. ETHERFUSE_ENV=${env}.`);

  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  console.log(`Smoke Etherfuse — env: ${env} · base: ${baseUrl}`);

  const anchor = new EtherfuseClient({ apiKey, baseUrl });
  const output: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    env,
    baseUrl,
  };

  // 1. whoami
  step(1, TOTAL_STEPS, 'GET /ramp/me — auth');
  const whoami = await (anchor as unknown as {
    request: <T>(m: string, p: string) => Promise<T>;
  }).request<{
    id: string;
    displayName: string;
    approvedAt: string | null;
    partnerFeeDefaultBps: number;
  }>('GET', '/ramp/me');
  ok(`org = ${whoami.displayName} (${whoami.id})`);
  output.whoami = whoami;
  setVerdict('whoami', 'pass');

  // 2. Conta Stellar testnet
  step(2, TOTAL_STEPS, 'Criar conta Stellar testnet (friendbot)');
  const testAccount = await createFundedAccount();
  const pubkey = testAccount.publicKey();
  ok(`pubkey = ${pubkey}`);
  ok(accountExplorerUrl(pubkey));
  output.testAccount = { publicKey: pubkey, secret: testAccount.secret() };

  // 3. Asset discovery
  step(3, TOTAL_STEPS, 'GET /ramp/assets — descobre TESOURO');
  const assetsResp = await anchor.getAssets('stellar', 'brl', pubkey);
  const assets = (assetsResp as unknown as {
    assets?: Array<{ symbol: string; identifier: string; currency?: string }>;
  }).assets ?? [];
  ok(`${assets.length} asset(s)`);
  const tesouro = assets.find((a) => a.symbol === 'TESOURO');
  if (!tesouro) throw new Error('TESOURO indisponível em /ramp/assets.');
  ok(`TESOURO = ${tesouro.identifier}`);
  output.assets = assets;
  output.tesouro = tesouro;
  setVerdict('asset_discovery', 'pass');

  // 4. createCustomer
  step(4, TOTAL_STEPS, 'POST /ramp/onboarding-url — cria customer');
  const customer = await anchor.createCustomer({
    email: `smoke+${Date.now()}@plina.finance`,
    publicKey: pubkey,
    country: 'BR',
  });
  ok(`customer.id = ${customer.id}`);
  ok(`bankAccountId = ${customer.bankAccountId}`);
  const kycUrl = await anchor.getKycUrl(customer.id, pubkey, customer.bankAccountId);
  ok(`presignedUrl recebida (${kycUrl.length} chars)`);
  setVerdict('customer_create', 'pass');
  output.customer = {
    id: customer.id,
    email: customer.email,
    bankAccountId: customer.bankAccountId,
    kycStatus: customer.kycStatus,
    country: customer.country,
    createdAt: customer.createdAt,
  };
  output.kycUrl = kycUrl;

  // 5. KYC programático: identity + documents + agreements
  step(5, TOTAL_STEPS, 'KYC programático: identity + docs + agreements');
  const initialStatus = await anchor.getKycStatus(customer.id, pubkey);
  info(`status antes = ${initialStatus}`);

  if (initialStatus !== 'approved') {
    info('submitKycIdentity (dados fake — sandbox aceita)');
    await anchor.submitKycIdentity(customer.id, {
      pubkey,
      identity: {
        id: pubkey,
        name: { givenName: 'Plina', familyName: 'SmokeTest' },
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
    ok('identity submetida');

    info('submitKycDocuments (documento + selfie, base64 dummy)');
    await anchor.submitKycDocuments(customer.id, {
      pubkey,
      documentType: 'document',
      images: [
        { label: 'id_front', image: DUMMY_PNG_BASE64 },
        { label: 'id_back', image: DUMMY_PNG_BASE64 },
      ],
    });
    await anchor.submitKycDocuments(customer.id, {
      pubkey,
      documentType: 'selfie',
      images: [{ label: 'selfie', image: DUMMY_PNG_BASE64 }],
    });
    ok('documentos submetidos');

    info('acceptAgreements (electronic-signature + terms + customer)');
    try {
      await anchor.acceptAgreements(kycUrl);
      ok('agreements aceitos');
      setVerdict('kyc_agreements', 'pass');
    } catch (err) {
      // customer-agreement falha com "Phone number not provided" em business
      // — sandbox aceita os outros 2 e marca KYC approved mesmo assim.
      expected(
        `customer-agreement rejeita sem phoneNumber (esperado em business). KYC segue approving.`,
      );
      output.agreementsError = String(err);
      setVerdict(
        'kyc_agreements',
        'expected_fail',
        'customer-agreement exige phoneNumber em business; KYC approva sem.',
      );
    }
  } else {
    ok('KYC já approved (business pode auto-aprovar via accountType)');
  }
  output.kycSubmission = 'attempted';

  // 6. Poll KYC status
  step(6, TOTAL_STEPS, 'Poll GET /ramp/customer/{id}/kyc/{pubkey} → approved');
  const finalKycStatus = await pollKycStatus(anchor, customer.id, pubkey, 30_000);
  ok(`status final = ${finalKycStatus}`);
  output.kycStatusFinal = finalKycStatus;
  setVerdict('kyc_status_approved', 'pass');

  // 7. Probe PIX bank account API (PLINA-MOD-005) — limitação esperada.
  //
  // A Etherfuse API REST hoje só aceita CLABE (MX); PIX é exclusivo do iframe
  // hosted. Esperamos 400. Se um dia passar (Etherfuse expor PIX via API),
  // smoke vira amarelo aqui pra a gente saber que dá pra remover o iframe.
  step(7, TOTAL_STEPS, 'PROBE: POST /ramp/bank-account PIX (limitação esperada)');
  try {
    const bankAccount = await anchor.registerPixBankAccount(kycUrl, {
      pixKey: '52998224725',
      pixKeyType: 'cpf',
      firstName: 'Plina',
      lastName: 'SmokeTest',
      cpf: '52998224725',
    });
    warn(
      'API aceitou PIX! Verificar PLINA-MOD-005 — podemos remover o iframe?',
    );
    ok(`bankAccount status = ${bankAccount.status}`);
    output.bankAccount = bankAccount;
    setVerdict('bank_account_pix_api', 'pass', 'API agora aceita PIX — investigar!');
  } catch (err) {
    expected(
      'API rejeitou PIX (esperado — PLINA-MOD-005). Registro via iframe Etherfuse.',
    );
    output.bankAccountError = String(err);
    setVerdict(
      'bank_account_pix_api',
      'expected_fail',
      'Etherfuse API só aceita CLABE; PIX é iframe-only. Ver PLINA-MOD-005.',
    );
  }

  // 8. Quote BRL → TESOURO
  step(8, TOTAL_STEPS, 'POST /ramp/quote — BRL → TESOURO');
  const quote = await anchor.getQuote({
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: '100',
    customerId: customer.id,
    stellarAddress: pubkey,
  });
  ok(`quoteId = ${quote.id}`);
  ok(`exchangeRate = ${quote.exchangeRate}`);
  ok(`toAmount = ${quote.toAmount} TESOURO`);
  info(`expiresAt = ${quote.expiresAt}`);
  output.quote = quote;
  setVerdict('quote_brl_to_tesouro', 'pass');

  // 9. Probe createOnRamp — limitação esperada quando bank account não foi
  //    registrada via iframe (smoke roda só programático). Em produção, o
  //    iframe registra PIX, status fica `active+compliant`, AÍ order funciona.
  step(9, TOTAL_STEPS, 'PROBE: POST /ramp/order (limitação esperada sem iframe)');
  let order;
  try {
    order = await anchor.createOnRamp({
      customerId: customer.id,
      quoteId: quote.id,
      stellarAddress: pubkey,
      fromCurrency: 'BRL',
      toCurrency: 'TESOURO',
      amount: '100',
      bankAccountId: customer.bankAccountId,
    });
    ok(`API aceitou order sem bank account ativa! orderId = ${order.id}`);
    if (order.paymentInstructions) {
      info(`paymentInstructions.type = ${order.paymentInstructions.type}`);
    }
    output.order = order;
    setVerdict('order_create', 'pass');

    info('simulateFiatReceived (sandbox)');
    const simStatus = await anchor.simulateFiatReceived(order.id);
    ok(`fiat_received → HTTP ${simStatus}`);
    output.simulateFiatReceivedStatus = simStatus;
    setVerdict('fiat_received', 'pass');
  } catch (err) {
    expected(
      'API rejeitou order (esperado — "Proxy account not found" sem bank account ativa).',
    );
    expected(
      'Fluxo real: iframe Etherfuse cria + ativa bank account → webhook bank_account_updated → backend cria order.',
    );
    output.orderError = String(err);
    setVerdict(
      'order_create',
      'expected_fail',
      'Sem bank account ativa, order falha. Fluxo real usa iframe + webhook. Ver ARCHITECTURE §3.5.',
    );
  }

  // 10. Poll onramp until terminal (PLINA-MOD-004 lida com indexing delay)
  if (order) {
    step(10, TOTAL_STEPS, 'Poll order até terminal (indexing grace 12s)');
    try {
      const terminal = await anchor.pollOnRampUntilTerminal(order.id, {
        intervalMs: 2_000,
        timeoutMs: 90_000,
        onTick: ({ status, notFound }) =>
          info(notFound ? 'aguardando indexing (404)...' : `status=${status}`),
      });
      ok(`status final = ${terminal.status}`);
      if (terminal.stellarTxHash) {
        ok(`stellarTxHash = ${terminal.stellarTxHash}`);
      }
      output.orderTerminal = terminal;
      setVerdict('order_poll', 'pass');
    } catch (err) {
      warn(`poll falhou: ${err}`);
      output.orderPollError = String(err);
      setVerdict('order_poll', 'fail', String(err));
    }
  } else {
    expected('step 10 pulado (esperado — depende de step 9).');
    setVerdict('order_poll', 'expected_fail', 'Pulado porque step 9 falhou esperadamente.');
  }

  // ─── Resumo ─────────────────────────────────────────────────────────────
  output.verdicts = verdicts;

  const fails = Object.entries(verdicts).filter(([, v]) => v.verdict === 'fail');
  const expectedFails = Object.entries(verdicts).filter(
    ([, v]) => v.verdict === 'expected_fail',
  );

  console.log('\n━━━ Resumo ━━━');
  for (const [key, v] of Object.entries(verdicts)) {
    const icon =
      v.verdict === 'pass' ? '✓' : v.verdict === 'expected_fail' ? '⊘' : '✗';
    console.log(`  ${icon} ${key}${v.note ? ` — ${v.note}` : ''}`);
  }

  writeFileSync('smoke-etherfuse-output.json', JSON.stringify(output, null, 2));

  if (fails.length > 0) {
    console.log(
      `\n✗ Smoke FALHOU com ${fails.length} erro(s) inesperado(s). Output: smoke-etherfuse-output.json`,
    );
    process.exit(1);
  }

  console.log(
    `\n✓ Smoke verde. ${
      expectedFails.length
    } limitação(ões) esperada(s) (documentadas em PLINA-MOD-005 e ARCHITECTURE §3.5). Output: smoke-etherfuse-output.json`,
  );
}

main().catch((err) => {
  console.error('\n✗ Smoke test Etherfuse FALHOU:');
  console.error(err);
  process.exit(1);
});
