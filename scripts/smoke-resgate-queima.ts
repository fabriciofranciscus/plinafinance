/**
 * Smoke E2-4 — resgate = 1 tx, 2 pernas: PLINARF investidor → issuer (queima)
 * + TESOURO distributor → investidor. Só TESTNET, só chaves descartáveis.
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-resgate-queima.ts
 */
import { createHash } from 'node:crypto';
import { Asset, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { createFundedAccount, getAssetBalance, horizon } from '../lib/stellar/account';
import { STELLAR_NETWORK, networkPassphrase, txExplorerUrl } from '../lib/stellar/config';
import { authorizeTrustline, configureIssuerFlags, createTrustline, issueAsset } from '../lib/stellar/issuer';
import { assertResgateXdrMatchesQuote, buildResgateXdr } from '../lib/stellar/resgate';
import { KeypairSigner } from '../lib/stellar/signer';
import { submitWithPrivySignature } from '../lib/stellar/transactions';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function supplyTotal(issuer: string): Promise<string> {
  const page = await horizon.assets().forCode('PLINARF').forIssuer(issuer).call();
  const r = page.records[0];
  if (!r) return '0';
  return (Number(r.balances.authorized) + Number(r.balances.authorized_to_maintain_liabilities) + Number(r.balances.unauthorized)).toFixed(7);
}

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');
  const [issuer, distributor, investor, bridgeIssuer] = await Promise.all(Array.from({ length: 4 }, () => createFundedAccount()));
  const sIssuer = new KeypairSigner(issuer.secret());
  const sInv = new KeypairSigner(investor.secret());
  const sDist = new KeypairSigner(distributor.secret());
  await configureIssuerFlags(sIssuer);
  const tesouro = new Asset('TESOURO', bridgeIssuer.publicKey());
  await createTrustline(sInv, issuer.publicKey(), 'PLINARF');
  await authorizeTrustline(sIssuer, investor.publicKey(), 'PLINARF');
  await createTrustline(sInv, bridgeIssuer.publicKey(), 'TESOURO');
  await createTrustline(sDist, bridgeIssuer.publicKey(), 'TESOURO');
  const em = await issueAsset(sIssuer, investor.publicKey(), '1000.0000000', 'PLINARF');
  ok(`investidor com 1000 PLINARF — ${txExplorerUrl(em.hash)}`);
  const fund = new TransactionBuilder(await horizon.loadAccount(bridgeIssuer.publicKey()), { fee: '1000', networkPassphrase })
    .addOperation(Operation.payment({ destination: distributor.publicKey(), asset: tesouro, amount: '5000' }))
    .setTimeout(60).build();
  fund.sign(bridgeIssuer);
  await horizon.submitTransaction(fund);
  await sleep(6000);
  const antes = await supplyTotal(issuer.publicKey());
  ok(`supply antes: ${antes}`);

  const memoHash = createHash('sha256').update('plina:resgate:smoke').digest();
  const exp = {
    investorPubkey: investor.publicKey(), issuerPubkey: issuer.publicKey(), distributorPubkey: distributor.publicKey(),
    bridgeAsset: { code: 'TESOURO', issuer: bridgeIssuer.publicKey() }, plinarfCode: 'PLINARF',
    expectedPlinarfAmount: '376.4705882', expectedBridgeAmount: '340.2300000', memoHash,
  };
  const { xdr } = await buildResgateXdr({
    investorPubkey: exp.investorPubkey, issuerPubkey: exp.issuerPubkey, distributorPubkey: exp.distributorPubkey,
    bridgeAsset: tesouro, plinarfCode: 'PLINARF', plinarfAmount: exp.expectedPlinarfAmount, bridgeAmount: exp.expectedBridgeAmount, memoHash,
  });
  assertResgateXdrMatchesQuote(xdr, exp);
  ok('validador aceitou o XDR do build');
  const tx = new Transaction(xdr, networkPassphrase);
  const res = await submitWithPrivySignature({
    xdr,
    investorPubkey: investor.publicKey(),
    investorSignatureHex: '0x' + investor.sign(tx.hash()).toString('hex'),
    extraSignatures: [{ pubkey: distributor.publicKey(), sigBase64: sDist.signatureBase64(tx) }],
  });
  ok(`resgate (2 pagamentos, 1 envelope) — ${txExplorerUrl(res.hash)}`);

  await sleep(6000);
  const depois = await supplyTotal(issuer.publicKey());
  const plinarfInv = await getAssetBalance(investor.publicKey(), 'PLINARF', issuer.publicKey());
  const tesInv = await getAssetBalance(investor.publicKey(), 'TESOURO', bridgeIssuer.publicKey());
  if (depois !== '623.5294118') throw new Error(`supply depois ${depois}`);
  if (plinarfInv !== '623.5294118' || tesInv !== '340.2300000') throw new Error(`saldos ${plinarfInv} / ${tesInv}`);
  ok(`supply depois: ${depois} (caiu 376.4705882); investidor ${plinarfInv} PLINARF e ${tesInv} TESOURO`);
  console.log('\nOK');
}
main().catch((err) => { console.error('FALHOU:', err instanceof Error ? err.message : err); process.exit(1); });
