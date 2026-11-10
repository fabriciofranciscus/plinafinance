/**
 * Validador de XDR de swap atômico (C-01).
 *
 * Parseia a XDR enviada pelo cliente em `/buy/swap/submit` e valida que as
 * 2 ops `payment` batem exatamente com o que o backend espera: leg 1 leva
 * `bridgeAsset` (TESOURO) do investor pro distributor no valor
 * `expectedBridgeAmount` (= `quote.toAmount`); leg 2 leva PLINARF do
 * distributor pro investor no valor `expectedPlinarfAmount`
 * (= `quote.plinarfAmount`, BRL ÷ NAV — M1-3, emissão ao NAV). As duas
 * pernas têm amounts distintos; cada uma é conferida contra o seu.
 *
 * Por que: signature em rawSign cobre o `tx.hash()`. Stellar aceita
 * qualquer XDR válida com hash assinado — não há ligação cripto entre
 * "amount que o backend quer" e "amount que o investor assinou". Sem
 * essa validação, o cliente pode forjar XDR com PLINARF inflado e
 * passar pelo submit.
 */
import { Asset, Transaction, type Operation } from '@stellar/stellar-sdk';
import { networkPassphrase, assetCode } from './config';

type AnyOp = Transaction['operations'][number];

export interface SwapXdrExpectation {
  investorPubkey: string;
  distributorPubkey: string;
  issuerPubkey: string;
  bridgeAsset: { code: string; issuer: string };
  /** Perna 1 (TESOURO pago) = `quote.toAmount`, 7 casas. */
  expectedBridgeAmount: string;
  /** Perna 2 (PLINARF emitido) = `quote.plinarfAmount`, 7 casas. */
  expectedPlinarfAmount: string;
  /** Code do asset emitido (PLINARF Sênior / PLINARFB Subordinada). Default PLINARF. */
  plinarfCode?: string;
}

function isPayment(op: AnyOp): op is Operation.Payment {
  return op.type === 'payment';
}

/** Amount Stellar canônico: positivo, exatamente 7 casas (como `op.amount`). */
const STELLAR_AMOUNT = /^\d{1,12}\.\d{7}$/;

function assertExpectedAmount(nome: string, valor: unknown): void {
  if (
    typeof valor !== 'string' ||
    !STELLAR_AMOUNT.test(valor) ||
    /^0+\.0+$/.test(valor)
  ) {
    throw new Error(
      `expectativa ${nome} inválida: precisa ser amount Stellar > 0 com 7 casas`,
    );
  }
}

function fmtAsset(a: Asset): string {
  return a.isNative() ? 'native' : `${a.code}:${a.issuer}`;
}

export function assertSwapXdrMatchesQuote(
  xdr: string,
  expected: SwapXdrExpectation,
): void {
  // Fail-closed antes de olhar o XDR: expectativa malformada (ou chamador
  // legado com `expectedAmount`) nunca vira comparação frouxa.
  assertExpectedAmount('expectedBridgeAmount', expected.expectedBridgeAmount);
  assertExpectedAmount('expectedPlinarfAmount', expected.expectedPlinarfAmount);

  let tx: Transaction;
  try {
    tx = new Transaction(xdr, networkPassphrase);
  } catch (err) {
    throw new Error(
      `xdr inválida ou networkPassphrase divergente: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (tx.source !== expected.investorPubkey) {
    throw new Error(
      `xdr.source=${tx.source} ≠ investorPubkey=${expected.investorPubkey}`,
    );
  }

  if (tx.operations.length !== 2) {
    throw new Error(
      `xdr deve ter exatamente 2 ops payment, tem ${tx.operations.length}`,
    );
  }

  const [op1, op2] = tx.operations;
  if (!op1 || !isPayment(op1)) {
    throw new Error('xdr op[0] não é payment');
  }
  if (!op2 || !isPayment(op2)) {
    throw new Error('xdr op[1] não é payment');
  }

  // Leg 1: investor → distributor, bridge asset (TESOURO).
  const bridge = new Asset(
    expected.bridgeAsset.code,
    expected.bridgeAsset.issuer,
  );
  const op1Source = op1.source ?? tx.source;
  if (op1Source !== expected.investorPubkey) {
    throw new Error(`leg1 source=${op1Source} ≠ investor`);
  }
  if (op1.destination !== expected.distributorPubkey) {
    throw new Error(`leg1 destination=${op1.destination} ≠ distributor`);
  }
  if (!op1.asset.equals(bridge)) {
    throw new Error(
      `leg1 asset=${fmtAsset(op1.asset)} ≠ ${fmtAsset(bridge)}`,
    );
  }
  if (op1.amount !== expected.expectedBridgeAmount) {
    throw new Error(
      `leg1 amount=${op1.amount} ≠ esperado=${expected.expectedBridgeAmount}`,
    );
  }

  // Leg 2: distributor → investor, PLINARF (Sênior) ou PLINARFB (Subordinada).
  const plinarf = new Asset(
    expected.plinarfCode ?? assetCode,
    expected.issuerPubkey,
  );
  const op2Source = op2.source ?? tx.source;
  if (op2Source !== expected.distributorPubkey) {
    throw new Error(`leg2 source=${op2Source} ≠ distributor`);
  }
  if (op2.destination !== expected.investorPubkey) {
    throw new Error(`leg2 destination=${op2.destination} ≠ investor`);
  }
  if (!op2.asset.equals(plinarf)) {
    throw new Error(
      `leg2 asset=${fmtAsset(op2.asset)} ≠ ${fmtAsset(plinarf)}`,
    );
  }
  if (op2.amount !== expected.expectedPlinarfAmount) {
    throw new Error(
      `leg2 amount=${op2.amount} ≠ esperado=${expected.expectedPlinarfAmount}`,
    );
  }
}
