/**
 * Smoke N1 — swap de subscrição com a perna 2 vinda do issuer (emissão nova).
 *
 * Só TESTNET e só chaves descartáveis (friendbot): issuer PLINARF com as
 * flags de produção (AUTH_REQUIRED + REVOCABLE + CLAWBACK), distributor,
 * investidor e um issuer descartável do ativo-ponte. Não usa o issuer do
 * projeto, para não cunhar PLINARF real de testnet e não mexer no NAV.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-swap-leg2-issuer.ts
 */
import {
  Asset,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { createFundedAccount, getAssetBalance, horizon } from '../lib/stellar/account';
import { STELLAR_NETWORK, networkPassphrase, txExplorerUrl } from '../lib/stellar/config';
import {
  authorizeTrustline,
  configureIssuerFlags,
  createTrustline,
} from '../lib/stellar/issuer';
import { assertSwapXdrMatchesQuote } from '../lib/stellar/parse-swap-xdr';
import { KeypairSigner } from '../lib/stellar/signer';
import { buildSwapBridgeForPlinarfXdr } from '../lib/stellar/transactions';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const BRIDGE_AMOUNT = '340.2300000';
const PLINARF_AMOUNT = '376.4705882';

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');

  console.log('1. contas descartáveis');
  const [issuer, distributor, investor, bridgeIssuer] = await Promise.all([
    createFundedAccount(),
    createFundedAccount(),
    createFundedAccount(),
    createFundedAccount(),
  ]);
  const sIssuer = new KeypairSigner(issuer.secret());
  const flags = await configureIssuerFlags(sIssuer);
  ok(`flags do issuer — ${txExplorerUrl(flags.hash)}`);

  console.log('2. trustlines, autorização e ativo-ponte');
  const tesouro = new Asset('TESOURO', bridgeIssuer.publicKey());
  await createTrustline(new KeypairSigner(investor.secret()), bridgeIssuer.publicKey(), 'TESOURO');
  await createTrustline(new KeypairSigner(distributor.secret()), bridgeIssuer.publicKey(), 'TESOURO');
  await createTrustline(new KeypairSigner(investor.secret()), issuer.publicKey(), 'PLINARF');
  await authorizeTrustline(sIssuer, investor.publicKey(), 'PLINARF');
  const fund = new TransactionBuilder(await horizon.loadAccount(bridgeIssuer.publicKey()), {
    fee: '1000',
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({ destination: investor.publicKey(), asset: tesouro, amount: BRIDGE_AMOUNT }),
    )
    .setTimeout(60)
    .build();
  fund.sign(bridgeIssuer);
  await horizon.submitTransaction(fund);
  ok(`investidor com ${BRIDGE_AMOUNT} TESOURO`);

  console.log('3. swap: perna 1 investidor → distributor, perna 2 issuer → investidor');
  const expect = {
    investorPubkey: investor.publicKey(),
    distributorPubkey: distributor.publicKey(),
    issuerPubkey: issuer.publicKey(),
    bridgeAsset: { code: 'TESOURO', issuer: bridgeIssuer.publicKey() },
    expectedBridgeAmount: BRIDGE_AMOUNT,
    expectedPlinarfAmount: PLINARF_AMOUNT,
    plinarfCode: 'PLINARF',
  };
  const { xdr } = await buildSwapBridgeForPlinarfXdr({
    investorPubkey: investor.publicKey(),
    bridgeAsset: tesouro,
    bridgeAmount: BRIDGE_AMOUNT,
    plinarfAmount: PLINARF_AMOUNT,
    issuerPubkey: issuer.publicKey(),
    distributorPubkey: distributor.publicKey(),
    plinarfCode: 'PLINARF',
  });
  assertSwapXdrMatchesQuote(xdr, expect);
  ok('validador aceitou o XDR do builder');
  const tx = new Transaction(xdr, networkPassphrase);
  tx.sign(investor);
  sIssuer.sign(tx);
  const res = await horizon.submitTransaction(tx);
  ok(`swap — ${txExplorerUrl(res.hash)}`);

  console.log('4. saldos depois do swap');
  const plinarfInv = await getAssetBalance(investor.publicKey(), 'PLINARF', issuer.publicKey());
  const tesouroDist = await getAssetBalance(distributor.publicKey(), 'TESOURO', bridgeIssuer.publicKey());
  const plinarfDist = await getAssetBalance(distributor.publicKey(), 'PLINARF', issuer.publicKey());
  if (plinarfInv !== PLINARF_AMOUNT) throw new Error(`PLINARF do investidor ${plinarfInv}`);
  if (tesouroDist !== BRIDGE_AMOUNT) throw new Error(`TESOURO do distributor ${tesouroDist}`);
  if (plinarfDist !== '0') throw new Error(`distributor tem PLINARF ${plinarfDist}`);
  ok(`investidor ${plinarfInv} PLINARF (emitido); distributor ${tesouroDist} TESOURO e 0 PLINARF`);

  console.log('5. XDR com a perna 2 vinda do distributor é recusado');
  const errado = new TransactionBuilder(await horizon.loadAccount(investor.publicKey()), {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({ source: investor.publicKey(), destination: distributor.publicKey(), asset: tesouro, amount: BRIDGE_AMOUNT }),
    )
    .addOperation(
      Operation.payment({
        source: distributor.publicKey(),
        destination: investor.publicKey(),
        asset: new Asset('PLINARF', issuer.publicKey()),
        amount: PLINARF_AMOUNT,
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
  try {
    assertSwapXdrMatchesQuote(errado, expect);
    throw new Error('validador aceitou perna 2 do distributor');
  } catch (err) {
    if (!(err instanceof Error) || !/leg2 source/.test(err.message)) throw err;
    ok(`recusado: ${err.message.replace(/G[A-Z0-9]{55}/g, (k) => `${k.slice(0, 4)}…`)}`);
  }

  console.log('\nOK');
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
