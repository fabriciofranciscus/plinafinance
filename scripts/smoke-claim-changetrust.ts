/**
 * Smoke E2-1 — claim com changeTrust, XDR expirado e aporte da 2ª trustline.
 *
 * Só TESTNET e só chaves descartáveis geradas aqui (friendbot): não lê nem
 * usa nenhum segredo do projeto. Reproduz o formato da execução de
 * referência do anchor (tx 50a2f198…a311): changeTrust + claim num XDR.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-claim-changetrust.ts
 *
 * Passos:
 *  1. issuer e funder descartáveis via friendbot; investidor criado pelo
 *     funder com 1 XLM (o mínimo, como a carteira que o anchor deixa).
 *  2. issuer cria um claimable balance de SMOKECB para o investidor.
 *  3. prepararClaimXdr recusa por reserva e informa o aporte exato.
 *  4. aporte do funder (buildAporteReservaXdr), submetido.
 *  5. XDR do claim montado e deixado expirar; o submit dele dá tx_too_late.
 *  6. prepararClaimXdr com o XDR expirado regenera; submit OK.
 *  7. Reenvio: CB some do ledger (CB_NOT_FOUND) e a tx é achada pelo hash.
 */
import {
  Asset,
  Claimant,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { horizon } from '../lib/stellar/account';
import {
  STELLAR_NETWORK,
  friendbotUrl,
  networkPassphrase,
  txExplorerUrl,
} from '../lib/stellar/config';
import {
  ClaimError,
  buildAporteReservaXdr,
  erroDeXdrExpirado,
  prepararClaimXdr,
  xdrExpirado,
} from '../lib/stellar/claim';
import { fetchTransactionByHash, txHashFromXdr } from '../lib/stellar/transactions';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const links: string[] = [];

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

async function submit(tx: Transaction, rotulo: string) {
  const res = await horizon.submitTransaction(tx);
  const url = txExplorerUrl(res.hash);
  links.push(`${rotulo}: ${url}`);
  ok(`${rotulo} — ${url}`);
  return res.hash;
}

async function friendbot(pubkey: string) {
  const res = await fetch(`${friendbotUrl}?addr=${pubkey}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
}

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') {
    throw new Error('smoke só roda em TESTNET');
  }

  console.log('1. contas descartáveis');
  const issuer = Keypair.random();
  const funder = Keypair.random();
  const investor = Keypair.random();
  await Promise.all([friendbot(issuer.publicKey()), friendbot(funder.publicKey())]);
  const criar = new TransactionBuilder(await horizon.loadAccount(funder.publicKey()), {
    fee: '1000',
    networkPassphrase,
  })
    .addOperation(
      Operation.createAccount({ destination: investor.publicKey(), startingBalance: '1' }),
    )
    .setTimeout(60)
    .build();
  criar.sign(funder);
  await submit(criar, 'investidor criado com 1 XLM');

  console.log('2. claimable balance do issuer para o investidor');
  const asset = new Asset('SMOKECB', issuer.publicKey());
  const cbTx = new TransactionBuilder(await horizon.loadAccount(issuer.publicKey()), {
    fee: '1000',
    networkPassphrase,
  })
    .addOperation(
      Operation.createClaimableBalance({
        asset,
        amount: '10',
        claimants: [new Claimant(investor.publicKey(), Claimant.predicateUnconditional())],
      }),
    )
    .setTimeout(60)
    .build();
  cbTx.sign(issuer);
  const cbHash = await submit(cbTx, 'CB criado');
  const cbs = await horizon
    .claimableBalances()
    .claimant(investor.publicKey())
    .call();
  const balanceId = cbs.records[0]?.id;
  if (!balanceId) throw new Error(`CB não apareceu (tx ${cbHash})`);
  ok(`balanceId ${balanceId}`);

  console.log('3. sem reserva: recusa com aporte exato');
  const semReserva = await prepararClaimXdr({
    investorPubkey: investor.publicKey(),
    balanceId,
  }).catch((e: unknown) => e);
  if (!(semReserva instanceof ClaimError) || semReserva.code !== 'RESERVA_INSUFICIENTE') {
    throw new Error('esperava RESERVA_INSUFICIENTE');
  }
  ok(`RESERVA_INSUFICIENTE, aporte ${semReserva.aporteXlm} XLM`);

  console.log('4. aporte do funder');
  const aporte = await buildAporteReservaXdr({
    funderPubkey: funder.publicKey(),
    investorPubkey: investor.publicKey(),
    amountXlm: semReserva.aporteXlm!,
  });
  const aporteTx = new Transaction(aporte.xdr, networkPassphrase);
  aporteTx.sign(funder);
  await submit(aporteTx, `aporte ${semReserva.aporteXlm} XLM`);

  console.log('5. XDR do claim deixado expirar');
  const velho = await prepararClaimXdr({ investorPubkey: investor.publicKey(), balanceId });
  ok(`operações: ${velho.operacoes.join(' + ')}`);
  const maxTime = Number(new Transaction(velho.xdr, networkPassphrase).timeBounds?.maxTime);
  while (Math.floor(Date.now() / 1000) <= maxTime + 2) await sleep(5000);
  ok(`xdrExpirado = ${xdrExpirado(velho.xdr)}`);
  const velhoTx = new Transaction(velho.xdr, networkPassphrase);
  velhoTx.sign(investor);
  const tarde = await horizon.submitTransaction(velhoTx).catch((e: unknown) => e);
  if (!erroDeXdrExpirado(tarde)) throw new Error('esperava tx_too_late no XDR expirado');
  ok('submit do XDR expirado → tx_too_late');

  console.log('6. regenera e submete');
  const novo = await prepararClaimXdr({
    investorPubkey: investor.publicKey(),
    balanceId,
    xdrAnterior: velho.xdr,
  });
  if (!novo.regenerado) throw new Error('esperava XDR regenerado');
  const novoTx = new Transaction(novo.xdr, networkPassphrase);
  novoTx.sign(investor);
  const claimHash = await submit(novoTx, `claim (${novo.operacoes.join(' + ')})`);
  const acc = await horizon.loadAccount(investor.publicKey());
  const saldo = acc.balances.find(
    (b) => 'asset_code' in b && b.asset_code === 'SMOKECB',
  )?.balance;
  if (saldo !== '10.0000000') throw new Error(`saldo inesperado ${saldo}`);
  ok(`saldo SMOKECB ${saldo}`);

  console.log('7. reenvio idempotente');
  const deNovo = await prepararClaimXdr({
    investorPubkey: investor.publicKey(),
    balanceId,
  }).catch((e: unknown) => e);
  if (!(deNovo instanceof ClaimError) || deNovo.code !== 'CB_NOT_FOUND') {
    throw new Error('esperava CB_NOT_FOUND após o claim');
  }
  const achada = await fetchTransactionByHash(txHashFromXdr(novo.xdr));
  if (!achada?.successful || achada.hash !== claimHash) {
    throw new Error('tx do claim não reconciliou pelo hash do XDR');
  }
  ok('CB_NOT_FOUND + tx achada pelo hash do XDR');

  console.log('\nOK — links:');
  for (const l of links) console.log(`  ${l}`);
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
