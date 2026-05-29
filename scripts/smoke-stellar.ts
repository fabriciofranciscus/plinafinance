/**
 * Smoke test — trilho Stellar da POC.
 *
 * Valida em ~1 minuto que tudo que importa pra demo do hackathon funciona
 * na testnet, antes de gastar 2 dias construindo UI em cima:
 *
 *   1. Criar issuer (friendbot).
 *   2. Configurar AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED.
 *   3. Criar distributor + trustline + autorização.
 *   4. Emitir PLINARF do issuer → distributor.
 *   5. Criar "investidor" + trustline + autorização.
 *   6. Distribuir do distributor → investidor.
 *   7. Executar clawback do issuer no saldo do investidor.
 *
 * Falhas no smoke = produto não anda. Não construir UI até esse script
 * estar verde.
 *
 * Rodar:  npm run smoke:stellar
 * Saída:  smoke-stellar-output.json (NÃO commitar — contém secret keys).
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createFundedAccount } from '../lib/stellar/account';
import {
  accountExplorerUrl,
  assetCode,
  assetExplorerUrl,
  STELLAR_NETWORK,
  txExplorerUrl,
} from '../lib/stellar/config';
import {
  authorizeTrustline,
  configureIssuerFlags,
  createTrustline,
  distribute,
  executeClawback,
  issueAsset,
} from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';

const step = (n: number, label: string) =>
  console.log(`\n━━━ [${n}/7] ${label}`);

const ok = (msg: string) => console.log(`     ✓ ${msg}`);

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') {
    throw new Error(
      `Smoke test só roda em TESTNET. STELLAR_NETWORK atual: ${STELLAR_NETWORK}`,
    );
  }

  console.log(
    `Smoke test Stellar — asset ${assetCode} · network ${STELLAR_NETWORK}`,
  );

  // 1. Issuer
  step(1, 'Criar issuer (friendbot)');
  const issuer = await createFundedAccount();
  ok(`issuer = ${issuer.publicKey()}`);
  ok(accountExplorerUrl(issuer.publicKey()));

  // 2. Flags
  step(2, 'Configurar AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED');
  const flagsRes = await configureIssuerFlags(
    new KeypairSigner(issuer.secret()),
    'plina.finance',
  );
  ok(`tx = ${txExplorerUrl(flagsRes.hash)}`);
  ok(`asset = ${assetExplorerUrl(issuer.publicKey())}`);

  // 3. Distributor
  step(3, 'Criar distributor + trustline + autorização');
  const distributor = await createFundedAccount();
  ok(`distributor = ${distributor.publicKey()}`);
  const trustDistRes = await createTrustline(
    new KeypairSigner(distributor.secret()),
    issuer.publicKey(),
  );
  ok(`trustline tx = ${txExplorerUrl(trustDistRes.hash)}`);
  const authDistRes = await authorizeTrustline(
    new KeypairSigner(issuer.secret()),
    distributor.publicKey(),
  );
  ok(`authorize tx = ${txExplorerUrl(authDistRes.hash)}`);

  // 4. Emissão
  step(4, 'Emitir 100000 PLINARF do issuer → distributor');
  const issueRes = await issueAsset(
    new KeypairSigner(issuer.secret()),
    distributor.publicKey(),
    '100000',
  );
  ok(`emissão tx = ${txExplorerUrl(issueRes.hash)}`);

  // 5. Investidor
  step(5, 'Criar investidor + trustline + autorização');
  const investor = await createFundedAccount();
  ok(`investor = ${investor.publicKey()}`);
  const trustInvRes = await createTrustline(
    new KeypairSigner(investor.secret()),
    issuer.publicKey(),
  );
  ok(`trustline tx = ${txExplorerUrl(trustInvRes.hash)}`);
  const authInvRes = await authorizeTrustline(
    new KeypairSigner(issuer.secret()),
    investor.publicKey(),
  );
  ok(`authorize tx = ${txExplorerUrl(authInvRes.hash)}`);

  // 6. Distribuição
  step(6, 'Distribuir 1000 PLINARF distributor → investidor');
  const distRes = await distribute(
    new KeypairSigner(distributor.secret()),
    issuer.publicKey(),
    investor.publicKey(),
    '1000',
  );
  ok(`distribuição tx = ${txExplorerUrl(distRes.hash)}`);

  // 7. Clawback
  step(
    7,
    'Clawback de 500 PLINARF (motivo simulado: ERRO_OPERACIONAL)',
  );
  const clawRes = await executeClawback(
    new KeypairSigner(issuer.secret()),
    investor.publicKey(),
    '500',
  );
  ok(`clawback tx = ${txExplorerUrl(clawRes.hash)}`);

  const output = {
    network: STELLAR_NETWORK,
    asset: assetCode,
    issuer: { publicKey: issuer.publicKey(), secret: issuer.secret() },
    distributor: {
      publicKey: distributor.publicKey(),
      secret: distributor.secret(),
    },
    investor: { publicKey: investor.publicKey(), secret: investor.secret() },
    txs: {
      configureFlags: flagsRes.hash,
      trustlineDistributor: trustDistRes.hash,
      authorizeDistributor: authDistRes.hash,
      issue: issueRes.hash,
      trustlineInvestor: trustInvRes.hash,
      authorizeInvestor: authInvRes.hash,
      distribute: distRes.hash,
      clawback: clawRes.hash,
    },
    explorers: {
      issuer: accountExplorerUrl(issuer.publicKey()),
      asset: assetExplorerUrl(issuer.publicKey()),
      distributor: accountExplorerUrl(distributor.publicKey()),
      investor: accountExplorerUrl(investor.publicKey()),
    },
  };
  writeFileSync('smoke-stellar-output.json', JSON.stringify(output, null, 2));

  console.log(
    '\n✓ Smoke test verde. Output em smoke-stellar-output.json (NÃO commitar).',
  );
}

main().catch((err) => {
  console.error('\n✗ Smoke test FALHOU:');
  console.error(err);
  process.exit(1);
});
