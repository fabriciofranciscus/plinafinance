/**
 * Smoke N1-at — emissão só para trustline autorizada. Só TESTNET, só chaves
 * descartáveis (friendbot); não usa o issuer do projeto.
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-n1-at.ts
 */
import { Asset, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { createFundedAccount, horizon } from '../lib/stellar/account';
import { STELLAR_NETWORK, networkPassphrase, txExplorerUrl } from '../lib/stellar/config';
import { authorizeTrustline, configureIssuerFlags, createTrustline } from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';
import { buildSwapBridgeForPlinarfXdr, submitWithPrivySignature } from '../lib/stellar/transactions';
import { TrustlineNaoAutorizadaError } from '../lib/stellar/trustline';

const ok = (m: string) => console.log(`  ✓ ${m}`);

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');
  const [issuer, distributor, investor, bridgeIssuer] = await Promise.all(
    Array.from({ length: 4 }, () => createFundedAccount()),
  );
  const sIssuer = new KeypairSigner(issuer.secret());
  await configureIssuerFlags(sIssuer);
  const tesouro = new Asset('TESOURO', bridgeIssuer.publicKey());
  await createTrustline(new KeypairSigner(investor.secret()), bridgeIssuer.publicKey(), 'TESOURO');
  await createTrustline(new KeypairSigner(distributor.secret()), bridgeIssuer.publicKey(), 'TESOURO');
  const trust = await createTrustline(new KeypairSigner(investor.secret()), issuer.publicKey(), 'PLINARF');
  ok(`trustline PLINARF criada, ainda NÃO autorizada — ${txExplorerUrl(trust.hash)}`);
  const fund = new TransactionBuilder(await horizon.loadAccount(bridgeIssuer.publicKey()), { fee: '1000', networkPassphrase })
    .addOperation(Operation.payment({ destination: investor.publicKey(), asset: tesouro, amount: '10' }))
    .setTimeout(60).build();
  fund.sign(bridgeIssuer);
  await horizon.submitTransaction(fund);

  const montar = () => buildSwapBridgeForPlinarfXdr({
    investorPubkey: investor.publicKey(), bridgeAsset: tesouro, bridgeAmount: '10.0000000',
    plinarfAmount: '9.4117647', issuerPubkey: issuer.publicKey(), distributorPubkey: distributor.publicKey(),
    plinarfCode: 'PLINARF',
  });

  const recusa = await montar().catch((e: unknown) => e);
  if (!(recusa instanceof TrustlineNaoAutorizadaError) || recusa.code !== 'TRUSTLINE_NAO_AUTORIZADA') {
    throw new Error('esperava TRUSTLINE_NAO_AUTORIZADA no build');
  }
  ok('build recusado: TRUSTLINE_NAO_AUTORIZADA (nada submetido)');

  const auth = await authorizeTrustline(sIssuer, investor.publicKey(), 'PLINARF');
  ok(`trustline autorizada pelo issuer — ${txExplorerUrl(auth.hash)}`);

  const { xdr } = await montar();
  const tx = new Transaction(xdr, networkPassphrase);
  const res = await submitWithPrivySignature({
    xdr,
    investorPubkey: investor.publicKey(),
    investorSignatureHex: '0x' + investor.sign(tx.hash()).toString('hex'),
    extraSignatures: [{ pubkey: issuer.publicKey(), sigBase64: sIssuer.signatureBase64(tx) }],
  });
  ok(`swap com emissão para trustline autorizada — ${txExplorerUrl(res.hash)}`);
  console.log('\nOK');
}

main().catch((err) => { console.error('FALHOU:', err instanceof Error ? err.message : err); process.exit(1); });
