/**
 * Smoke test — Etherfuse Ramp API contra o sandbox.
 *
 * Valida o caminho COMPLETO programático (sem hosted iframe) que a Plina
 * usa em produção — investidor institucional não preenche iframe genérico,
 * Plina submete KYC via API a partir do form white-label dela.
 *
 * NOTA PLINA-MOD-005 (revisado 2026-05-20):
 *   `POST /ramp/bank-account` está fechada upstream para **ambos** os
 *   trilhos PIX (BR) e CLABE (MX). O smoke abaixo prova isso com 2 probes
 *   consecutivos (steps 7a + 7b). O caminho de produção pra criar ordens
 *   sem iframe usa o mock sandbox documentado em ARCHITECTURE §3.5 / doc
 *   2026-05-18-quote-binding-and-atomic-swap.md §2.2.
 *
 *   1. GET /ramp/me — auth.
 *   2. Stellar account testnet (friendbot).
 *   3. GET /ramp/assets — descobre TESOURO + CETES.
 *   4. POST /ramp/onboarding-url — cria customer (PLINA-MOD-001 accountType business).
 *   5. POST /ramp/customer/{id}/kyc + /kyc/documents + agreements — KYC programático.
 *   6. Poll GET /ramp/customer/{id}/kyc/{pubkey} — espera status approved.
 *   7. PROBE: POST /ramp/bank-account PIX + CLABE — ambos fechados upstream.
 *   8. POST /ramp/quote BRL → TESOURO.
 *   9. PROBE: POST /ramp/order — falha sem bank ativa (esperado).
 *  10. Poll order — pulado quando step 9 falha esperadamente.
 *
 * Falhas inesperadas indicam contrato quebrado com sandbox Etherfuse.
 *
 * Rodar:  npm run smoke:etherfuse
 * Saída:  smoke-etherfuse-output.json (NÃO commitar — pode conter secret keys de teste).
 */

import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { Asset, Transaction, TransactionBuilder, Operation } from '@stellar/stellar-sdk';
import { EtherfuseClient } from '../lib/anchors/etherfuse';
import { createFundedAccount, getAssetBalance, horizon } from '../lib/stellar/account';
import { accountExplorerUrl, networkPassphrase, STELLAR_TX_TIMEOUT_SEC } from '../lib/stellar/config';
import { getDynamicFee } from '../lib/stellar/fee';
import { buildClaimClaimableBalanceXdr } from '../lib/stellar/transactions';

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

const TOTAL_STEPS = 14;

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
        phoneNumber: '+5511999999999',
        email: `smoke+${Date.now()}@plina.finance`,
        occupation: 'Gestor de Fundo',
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

  // 7. Probe duplo: POST /ramp/bank-account com PIX e CLABE.
  //
  //    Finding 2026-05-20: o endpoint está fechado upstream pra AMBOS os trilhos
  //    (PIX e CLABE). Confirmado pelo client de referência da SDF DevRel
  //    (ElliotFriend/regional-starter-pack/src/lib/anchors/etherfuse/client.ts):
  //    `fiatAccountRegistration: 'hosted'`. Registro de bank account é
  //    obrigatoriamente via iframe + webhook `bank_account_updated`.
  //
  //    O smoke documenta isso com 2 probes consecutivos. Se um dia algum dos
  //    rails passar, vira `pass` (warn) e sabemos que dá pra ir headless.
  step(7, TOTAL_STEPS, 'PROBE: POST /ramp/bank-account PIX + CLABE (ambos iframe-only)');
  try {
    const bankResp = await anchor.registerPixBankAccount(kycUrl, {
      pixKey: '52998224725',
      pixKeyType: 'cpf',
      firstName: 'Plina',
      lastName: 'SmokeTest',
      cpf: '52998224725',
    });
    ok(`PIX bank registrado: status=${bankResp.status} compliant=${bankResp.compliant ?? 'n/a'}`);
    output.bankRegisterResponse = bankResp;
    // Lista accounts pra confirmar estado pós-registro
    const accountsAfter = await anchor.getFiatAccounts(customer.id);
    info(`getFiatAccounts pós-registro: ${JSON.stringify(accountsAfter)}`);
    output.fiatAccountsAfterRegister = accountsAfter;
    setVerdict('bank_account_pix_api', 'pass', 'API agora aceita PIX — investigar!');
  } catch (err) {
    expected('PIX rejeitado (esperado — fiatAccountRegistration=hosted upstream).');
    output.bankAccountPixError = String(err);
    setVerdict(
      'bank_account_pix_api',
      'expected_fail',
      'PIX é iframe-only por design upstream (SDF DevRel client.ts:75).',
    );
  }
  try {
    await anchor.registerSpeiBankAccount(kycUrl, {
      clabe: '646180157028000007',
      beneficiary: 'Plina SmokeTest',
      bankName: 'STP',
    });
    warn('API aceitou CLABE! Verificar — podemos remover o iframe?');
    setVerdict('bank_account_clabe_api', 'pass', 'API agora aceita CLABE — investigar!');
  } catch (err) {
    expected('CLABE rejeitado (esperado — mesmo enum AccountRegistration fechado).');
    output.bankAccountClabeError = String(err);
    setVerdict(
      'bank_account_clabe_api',
      'expected_fail',
      'CLABE também é iframe-only — finding 2026-05-20 amplia PLINA-MOD-005.',
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

  // 8.5. Trustline TESOURO (pré-req pro mint da Etherfuse pagar a wallet).
  //      PLINA-MOD-006: agora que bank-account é programático, trustline
  //      precisa estar estabelecida antes do mint terminar.
  const tesouroIdParts = tesouro.identifier.split(':');
  const tesouroCode = tesouroIdParts[0];
  const tesouroIssuer = tesouroIdParts[1];
  if (!tesouroCode || !tesouroIssuer) {
    throw new Error(`TESOURO identifier inválido: ${tesouro.identifier}`);
  }
  const tesouroAsset = new Asset(tesouroCode, tesouroIssuer);
  step(9, TOTAL_STEPS, 'Trustline TESOURO (changeTrust + sign local)');
  {
    const account = await horizon.loadAccount(pubkey);
    const trustTx = new TransactionBuilder(account, {
      fee: await getDynamicFee(),
      networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset: tesouroAsset }))
      .setTimeout(STELLAR_TX_TIMEOUT_SEC)
      .build();
    trustTx.sign(testAccount);
    const trustRes = await horizon.submitTransaction(trustTx);
    ok(`trustline TESOURO txHash=${trustRes.hash}`);
    output.trustlineTxHash = trustRes.hash;
    setVerdict('trustline_tesouro', 'pass');
  }

  // 10. createOnRamp — PLINA-MOD-006: deve passar agora que bank-account é
  //     programático (transactionId injetado).
  step(10, TOTAL_STEPS, 'POST /ramp/order — onramp BRL → TESOURO');
  const order = await anchor.createOnRamp({
    customerId: customer.id,
    quoteId: quote.id,
    stellarAddress: pubkey,
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    amount: '100',
    bankAccountId: customer.bankAccountId,
  });
  ok(`onramp orderId = ${order.id}`);
  output.order = order;
  setVerdict('order_create', 'pass');

  info('simulateFiatReceived (sandbox)');
  const simStatus = await anchor.simulateFiatReceived(order.id);
  ok(`fiat_received → HTTP ${simStatus}`);
  output.simulateFiatReceivedStatus = simStatus;
  setVerdict('fiat_received', 'pass');

  // 11. Poll onramp até `completed` (mint real do TESOURO). Demo
  //     etherfuse-pix-demo step 15 prova que sandbox PIX/BRL completa em
  //     até ~10 min depois de simulateFiatReceived. Sem completed = sem
  //     mint = off-ramp burn não tem saldo.
  step(11, TOTAL_STEPS, 'Poll onramp até completed (timeout 10min — mint real do TESOURO)');
  try {
    const terminal = await anchor.pollOnRampUntilTerminal(order.id, {
      intervalMs: 5_000,
      timeoutMs: 600_000,
      onTick: ({ status, notFound }) =>
        info(notFound ? 'aguardando indexing (404)...' : `status=${status}`),
    });
    ok(`status final = ${terminal.status}`);
    if (terminal.stellarTxHash) {
      ok(`stellarTxHash = ${terminal.stellarTxHash}`);
    }
    if (terminal.stellarClaimableBalanceId) {
      ok(`stellarClaimableBalanceId = ${terminal.stellarClaimableBalanceId}`);
    }
    output.orderTerminal = terminal;
    setVerdict('order_poll', 'pass');

    // PLINA-MOD-007: Etherfuse paga TESOURO via ClaimableBalance (não
    // payment direto). Investor precisa fazer claim pra TESOURO entrar
    // na trustline. Senão getAssetBalance retorna 0.
    //
    // Smoke usa o MESMO buildClaimClaimableBalanceXdr que o handler
    // /buy/claim/build (codepath compartilhado). Se quebra um, quebra o
    // outro — paridade smoke ↔ produto.
    if (terminal.stellarClaimableBalanceId) {
      info('Claiming ClaimableBalance (PLINA-MOD-007 — helper compartilhado)');
      const built = await buildClaimClaimableBalanceXdr({
        investorPubkey: pubkey,
        balanceId: terminal.stellarClaimableBalanceId,
      });
      const claimTx = new Transaction(built.xdr, networkPassphrase);
      claimTx.sign(testAccount);
      const claimRes = await horizon.submitTransaction(claimTx);
      ok(`claim txHash=${claimRes.hash}`);
      output.claimTxHash = claimRes.hash;
      setVerdict('claim_claimable_balance', 'pass');
    } else {
      warn('Order completed sem stellarClaimableBalanceId — pode ser que mint vire payment direto em algum caso');
      setVerdict('claim_claimable_balance', 'expected_fail', 'sem ClaimableBalance no response');
    }
  } catch (err) {
    warn(`poll falhou: ${err}`);
    output.orderPollError = String(err);
    setVerdict('order_poll', 'fail', String(err));
  }

  // 12. Read-back de saldo TESOURO em Horizon (entrega 3 da Trilha 1).
  step(12, TOTAL_STEPS, 'Horizon /accounts/{pubkey} — read-back saldo TESOURO');
  let tesouroBalance = '0';
  try {
    tesouroBalance = await getAssetBalance(pubkey, tesouroCode, tesouroIssuer);
    ok(`TESOURO balance = ${tesouroBalance}`);
    output.tesouroBalanceAfterMint = tesouroBalance;
    if (Number(tesouroBalance) > 0) {
      setVerdict('tesouro_balance_read', 'pass');
    } else {
      setVerdict(
        'tesouro_balance_read',
        'fail',
        'balance=0 após onramp completed — mint TESOURO falhou em Stellar',
      );
    }
  } catch (err) {
    warn(`getAssetBalance falhou: ${err}`);
    setVerdict('tesouro_balance_read', 'fail', String(err));
  }

  // 13. createOffRamp — TESOURO → BRL, metade do saldo.
  step(13, TOTAL_STEPS, 'POST /ramp/quote + /ramp/order — offramp TESOURO → BRL');
  let offramp: Awaited<ReturnType<typeof anchor.createOffRamp>> | null = null;
  let signedBurnHash: string | null = null;
  try {
    const halfBalance = Math.max(Number(tesouroBalance) / 2, 0.01).toFixed(7);
    const offQuote = await anchor.getQuote({
      fromCurrency: 'TESOURO',
      toCurrency: 'BRL',
      fromAmount: halfBalance,
      customerId: customer.id,
      stellarAddress: pubkey,
    });
    ok(`offramp quoteId = ${offQuote.id}`);
    offramp = await anchor.createOffRamp({
      customerId: customer.id,
      quoteId: offQuote.id,
      stellarAddress: pubkey,
      fromCurrency: 'TESOURO',
      toCurrency: 'BRL',
      amount: halfBalance,
      fiatAccountId: customer.bankAccountId ?? '',
    });
    ok(`offramp orderId = ${offramp.id}`);
    output.offramp = offramp;
    setVerdict('offramp_create', 'pass');
  } catch (err) {
    warn(`offramp create falhou: ${err}`);
    output.offrampCreateError = String(err);
    setVerdict('offramp_create', 'fail', String(err));
  }

  // 14. Poll signableTransaction → sign local → submit Horizon → poll processing.
  if (offramp) {
    step(14, TOTAL_STEPS, 'Poll burn XDR → sign local → submit Horizon → poll processing');
    try {
      const ready = await anchor.pollOffRampForSignable(offramp.id, {
        intervalMs: 2_000,
        timeoutMs: 120_000,
      });
      if (!ready.signableTransaction) {
        throw new Error('signableTransaction ausente após poll');
      }
      ok(`burn XDR recebido (${ready.signableTransaction.length} chars)`);
      setVerdict('offramp_signable_ready', 'pass');

      const burnTx = new Transaction(ready.signableTransaction, networkPassphrase);
      burnTx.sign(testAccount);
      const submitted = await horizon.submitTransaction(burnTx);
      ok(`burn txHash = ${submitted.hash}`);
      signedBurnHash = submitted.hash;
      output.burnStellarTxHash = signedBurnHash;
      setVerdict('offramp_burn_submitted', 'pass');

      // Poll off-ramp até `processing` (Etherfuse raw `funded` — burn
      // confirmado on-chain). PIX/BRL sandbox não vai além disso (quirk #6),
      // mas `processing` é o terminal aceito pelo demo + nossa lib.
      const start = Date.now();
      const deadline = start + 180_000;
      let lastStatus = 'unknown';
      while (Date.now() < deadline) {
        const tx = await anchor.getOffRampTransaction(offramp.id);
        if (tx) {
          lastStatus = tx.status;
          info(`offramp status=${tx.status}`);
          if (tx.status === 'processing' || tx.status === 'completed') {
            ok(`offramp terminal = ${tx.status}`);
            output.offrampTerminal = tx;
            setVerdict('offramp_processing', 'pass');
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }
      if (!verdicts['offramp_processing']) {
        setVerdict(
          'offramp_processing',
          'fail',
          `timeout 180s — último status=${lastStatus}; off-ramp não atingiu processing`,
        );
      }
    } catch (err) {
      warn(`offramp burn flow falhou: ${err}`);
      output.offrampBurnError = String(err);
      if (!verdicts['offramp_signable_ready']) {
        setVerdict('offramp_signable_ready', 'fail', String(err));
      } else if (!verdicts['offramp_burn_submitted']) {
        setVerdict('offramp_burn_submitted', 'fail', String(err));
      } else {
        setVerdict('offramp_processing', 'fail', String(err));
      }
    }
  } else {
    expected('steps 14 pulados — offramp não foi criada.');
    setVerdict('offramp_signable_ready', 'expected_fail', 'Pulado: offramp create falhou.');
    setVerdict('offramp_burn_submitted', 'expected_fail', 'Pulado.');
    setVerdict('offramp_processing', 'expected_fail', 'Pulado.');
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
