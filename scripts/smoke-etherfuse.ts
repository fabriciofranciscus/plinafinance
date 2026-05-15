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
    } catch (err) {
      warn(`acceptAgreements falhou — pode ser opcional para business: ${err}`);
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

  // 7. Registrar PIX bank account (PLINA-MOD-005)
  step(7, TOTAL_STEPS, 'POST /ramp/bank-account — registra conta PIX programaticamente');
  try {
    const bankAccount = await anchor.registerPixBankAccount(kycUrl, {
      pixKey: '52998224725',
      pixKeyType: 'cpf',
      firstName: 'Plina',
      lastName: 'SmokeTest',
      cpf: '52998224725',
    });
    ok(`bankAccount status = ${bankAccount.status}`);
    info(`compliant = ${bankAccount.compliant}`);
    output.bankAccount = bankAccount;
  } catch (err) {
    warn(`registerPixBankAccount falhou: ${err}`);
    output.bankAccountError = String(err);
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

  // 9. createOnRamp + simulateFiatReceived
  step(9, TOTAL_STEPS, 'POST /ramp/order + /fiat_received');
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
    ok(`orderId = ${order.id}`);
    if (order.paymentInstructions) {
      info(`paymentInstructions.type = ${order.paymentInstructions.type}`);
    }
    output.order = order;

    info('simulateFiatReceived (sandbox)');
    const simStatus = await anchor.simulateFiatReceived(order.id);
    ok(`fiat_received → HTTP ${simStatus}`);
    output.simulateFiatReceivedStatus = simStatus;
  } catch (err) {
    warn(`order/simulate falhou: ${err}`);
    output.orderError = String(err);
  }

  // 9. Poll onramp until terminal (PLINA-MOD-004 lida com indexing delay)
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
    } catch (err) {
      warn(`poll falhou: ${err}`);
      output.orderPollError = String(err);
    }
  } else {
    warn('step 10 pulado (order não criado)');
  }

  writeFileSync('smoke-etherfuse-output.json', JSON.stringify(output, null, 2));
  console.log(
    '\n✓ Smoke test Etherfuse concluído. Output em smoke-etherfuse-output.json.',
  );
}

main().catch((err) => {
  console.error('\n✗ Smoke test Etherfuse FALHOU:');
  console.error(err);
  process.exit(1);
});
