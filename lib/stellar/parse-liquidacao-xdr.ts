/**
 * Validador de XDR de liquidação (C-03).
 *
 * Parseia a XDR enviada pelo cliente em `/liquidar/submit` e retorna o
 * `amount` autoritativo da própria XDR (não do body). Body.amount era
 * usado antes pra decrementar `saldoEsperado` — investor podia assinar
 * payment de 1000 PLINARF e mandar body.amount=100; chain decrementava
 * 1000, DB decrementava 100, gap de 900 "perdido".
 *
 * Exige:
 *  - source = investorPubkey.
 *  - exatamente 1 op payment.
 *  - asset = PLINARF (issuer esperado).
 *  - destination = distributorPubkey.
 *  - amount > 0.
 */
import { Asset, Transaction, type Operation } from '@stellar/stellar-sdk';
import { networkPassphrase, assetCode } from './config';

type AnyOp = Transaction['operations'][number];

export interface LiquidacaoXdrExpectation {
  investorPubkey: string;
  distributorPubkey: string;
  issuerPubkey: string;
}

function isPayment(op: AnyOp): op is Operation.Payment {
  return op.type === 'payment';
}

export function extractLiquidacaoAmount(
  xdr: string,
  expected: LiquidacaoXdrExpectation,
): string {
  let tx: Transaction;
  try {
    tx = new Transaction(xdr, networkPassphrase);
  } catch (err) {
    throw new Error(
      `xdr inválida ou networkPassphrase divergente: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (tx.source !== expected.investorPubkey) {
    throw new Error(`xdr.source=${tx.source} ≠ investorPubkey`);
  }
  if (tx.operations.length !== 1) {
    throw new Error(
      `xdr deve ter exatamente 1 op payment, tem ${tx.operations.length}`,
    );
  }
  const [op] = tx.operations;
  if (!op || !isPayment(op)) {
    throw new Error('xdr op[0] não é payment');
  }
  const plinarf = new Asset(assetCode, expected.issuerPubkey);
  if (!op.asset.equals(plinarf)) {
    throw new Error(
      `liquidação aceita só PLINARF; recebeu ${op.asset.isNative() ? 'native' : `${op.asset.code}:${op.asset.issuer}`}`,
    );
  }
  if (op.destination !== expected.distributorPubkey) {
    throw new Error(
      `payment destination=${op.destination} ≠ distributor=${expected.distributorPubkey}`,
    );
  }
  return op.amount;
}
