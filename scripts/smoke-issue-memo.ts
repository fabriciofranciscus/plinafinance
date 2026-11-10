/**
 * Smoke E1-4 parte 2 — emissão idempotente por memo.
 *
 * Só TESTNET e só chaves descartáveis (friendbot): issuer e destino são
 * gerados aqui. O issuer do ambiente é sobrescrito NESTE processo pelo
 * descartável, para `buscarEmissaoPorMemo` ler o issuer certo; nenhum segredo
 * do projeto é usado.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-issue-memo.ts
 *
 *  1. issuer e destino descartáveis; trustline PLINARF no destino.
 *  2. buscarEmissaoPorMemo antes de emitir → null.
 *  3. issueAsset com memoHash = sha256("plina:incorporacao:<id>").
 *  4. buscarEmissaoPorMemo acha a mesma tx e o mesmo amount (recuperação
 *     após crash: o caller não reemite).
 *  5. uma 2ª emissão com o mesmo memo → a busca lança EMISSAO_DUPLICADA.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createFundedAccount } from '../lib/stellar/account';
import { STELLAR_NETWORK, txExplorerUrl } from '../lib/stellar/config';
import {
  EmissaoPorMemoError,
  buscarEmissaoPorMemo,
  createTrustline,
  issueAsset,
} from '../lib/stellar/issuer';
import { KeypairSigner } from '../lib/stellar/signer';

const ok = (m: string) => console.log(`  ✓ ${m}`);

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');

  console.log('1. contas descartáveis + trustline');
  const issuer = await createFundedAccount();
  const destino = await createFundedAccount();
  process.env.STELLAR_ISSUER_PUBLIC = issuer.publicKey();
  const trust = await createTrustline(
    new KeypairSigner(destino.secret()),
    issuer.publicKey(),
    'PLINARF',
  );
  ok(`trustline — ${txExplorerUrl(trust.hash)}`);

  const memoHash = createHash('sha256')
    .update(`plina:incorporacao:smoke-${randomUUID()}`)
    .digest();
  const busca = { code: 'PLINARF', destination: destino.publicKey(), memoHash };

  console.log('2. busca antes de emitir');
  if ((await buscarEmissaoPorMemo(busca)) !== null) throw new Error('esperava null');
  ok('null');

  console.log('3. emissão com memo');
  const emissao = await issueAsset(
    new KeypairSigner(issuer.secret()),
    destino.publicKey(),
    '400.0000000',
    'PLINARF',
    { memoHash },
  );
  ok(`emissão — ${txExplorerUrl(emissao.hash)}`);

  console.log('4. busca pelo memo');
  const achada = await buscarEmissaoPorMemo(busca);
  if (achada?.txHash !== emissao.hash || achada.amount !== '400.0000000') {
    throw new Error(`busca não bateu: ${JSON.stringify(achada)}`);
  }
  ok(`achou a mesma tx ${achada.txHash} com ${achada.amount} PLINARF`);

  console.log('5. segunda emissão com o mesmo memo');
  const dup = await issueAsset(
    new KeypairSigner(issuer.secret()),
    destino.publicKey(),
    '1.0000000',
    'PLINARF',
    { memoHash },
  );
  ok(`2ª emissão — ${txExplorerUrl(dup.hash)}`);
  const err = await buscarEmissaoPorMemo(busca).catch((e: unknown) => e);
  if (!(err instanceof EmissaoPorMemoError) || err.code !== 'EMISSAO_DUPLICADA') {
    throw new Error('esperava EMISSAO_DUPLICADA');
  }
  ok('busca lança EMISSAO_DUPLICADA (não escolhe uma)');

  console.log('\nOK');
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
