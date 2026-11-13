/** QA Vera — N1-at na TESTNET: revogação ENTRE build e submit (contas descartáveis; não usa o issuer do projeto). */
import { Asset, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { createFundedAccount, horizon } from '../lib/stellar/account';
import { STELLAR_NETWORK, networkPassphrase } from '../lib/stellar/config';
import { authorizeTrustline, configureIssuerFlags, createTrustline, revokeTrustline } from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';
import { buildSwapBridgeForPlinarfXdr, submitWithPrivySignature } from '../lib/stellar/transactions';
import { TrustlineNaoAutorizadaError } from '../lib/stellar/trustline';

const ok = (m: string) => console.log(`  ✓ ${m}`);
async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('só TESTNET');
  const [issuer, distributor, investor, bridgeIssuer] = await Promise.all(Array.from({ length: 4 }, () => createFundedAccount()));
  const sIssuer = new KeypairSigner(issuer.secret());
  await configureIssuerFlags(sIssuer);
  const tesouro = new Asset('TESOURO', bridgeIssuer.publicKey());
  for (const k of [investor, distributor]) await createTrustline(new KeypairSigner(k.secret()), bridgeIssuer.publicKey(), 'TESOURO');
  await createTrustline(new KeypairSigner(investor.secret()), issuer.publicKey(), 'PLINARF');
  const fund = new TransactionBuilder(await horizon.loadAccount(bridgeIssuer.publicKey()), { fee: '1000', networkPassphrase })
    .addOperation(Operation.payment({ destination: investor.publicKey(), asset: tesouro, amount: '10' })).setTimeout(60).build();
  fund.sign(bridgeIssuer); await horizon.submitTransaction(fund);
  await authorizeTrustline(sIssuer, investor.publicKey(), 'PLINARF');

  const { xdr } = await buildSwapBridgeForPlinarfXdr({
    investorPubkey: investor.publicKey(), bridgeAsset: tesouro, bridgeAmount: '10.0000000', plinarfAmount: '9.4117647',
    issuerPubkey: issuer.publicKey(), distributorPubkey: distributor.publicKey(), plinarfCode: 'PLINARF',
  });
  ok('build com trustline autorizada: ok');
  await revokeTrustline(sIssuer, investor.publicKey(), 'PLINARF');
  ok('issuer REVOGOU a trustline entre build e submit');

  const antes = await horizon.loadAccount(investor.publicKey());
  const tx = new Transaction(xdr, networkPassphrase);
  const args = {
    xdr, investorPubkey: investor.publicKey(),
    investorSignatureHex: '0x' + investor.sign(tx.hash()).toString('hex'),
    extraSignatures: [{ pubkey: issuer.publicKey(), sigBase64: sIssuer.signatureBase64(tx) }],
  };
  const e = await submitWithPrivySignature(args).catch((x: unknown) => x);
  if (!(e instanceof TrustlineNaoAutorizadaError) || e.code !== 'TRUSTLINE_NAO_AUTORIZADA') throw new Error('esperava recusa tipada, veio: ' + String(e));
  const depois = await horizon.loadAccount(investor.publicKey());
  if (antes.sequenceNumber() !== depois.sequenceNumber()) throw new Error('sequence mudou — algo foi à rede');
  const txs = await horizon.transactions().forAccount(investor.publicKey()).order('desc').limit(1).call();
  if (txs.records[0].hash === tx.hash().toString('hex')) throw new Error('a tx entrou on-chain');
  ok('submit recusado SEM rede (TRUSTLINE_NAO_AUTORIZADA; sequence intacta; tx ausente do ledger)');

  await authorizeTrustline(sIssuer, investor.publicKey(), 'PLINARF');
  const res = await submitWithPrivySignature(args);
  ok('re-autorizada: a MESMA xdr assinada segue e entra (' + (res.successful ? 'successful' : 'falhou') + ')');
  console.log('\nOK');
}
main().catch((err) => { console.error('FALHOU:', err instanceof Error ? err.message : err); process.exit(1); });
