/**
 * Validador de XDR de swap atômico (C-01).
 *
 * Parseia a XDR enviada pelo cliente em `/buy/swap/submit` e valida que as
 * 2 ops `payment` batem exatamente com o que o backend espera: leg 1 leva
 * `bridgeAsset` (TESOURO) do investor pro distributor no valor
 * `expectedBridgeAmount` (= `quote.toAmount`); leg 2 leva PLINARF emitido pelo
 * issuer pro investor (N1) no valor `expectedPlinarfAmount`
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
import { networkPassphrase, assetCode, STELLAR_TX_TIMEOUT_SEC } from './config';

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

/** Folga de relógio entre o servidor e quem montou o envelope (s). */
const FOLGA_RELOGIO_MAX_SEC = 60;
const FOLGA_RELOGIO_MIN_SEC = 5;

/**
 * Janela de validade (N1 C1): o investidor monta e assina o envelope e o issuer
 * co-assina, então ela tem de ser curta e já aberta. Exige timeBounds;
 * 0 < maxTime ≤ agora + 120 s (build) + 60 s; minTime ≤ agora + 5 s. Tx já
 * expirada passa: quem barra é a rede. Relógio do servidor (não do Horizon).
 */
function assertJanelaDeValidade(tx: Transaction, agoraSec: number): void {
  const tb = tx.timeBounds;
  if (!tb) throw new Error('xdr sem timeBounds: a janela de validade é obrigatória');
  const maxTime = Number(tb.maxTime);
  const minTime = Number(tb.minTime);
  const limite = agoraSec + STELLAR_TX_TIMEOUT_SEC + FOLGA_RELOGIO_MAX_SEC;
  if (!Number.isFinite(maxTime) || maxTime <= 0) {
    throw new Error('xdr maxTime ausente (0): a tx valeria para sempre');
  }
  if (maxTime > limite) {
    throw new Error(`xdr maxTime=${maxTime} além do limite ${limite} (agora + ${STELLAR_TX_TIMEOUT_SEC + FOLGA_RELOGIO_MAX_SEC} s)`);
  }
  if (!Number.isFinite(minTime) || minTime > agoraSec + FOLGA_RELOGIO_MIN_SEC) {
    throw new Error(`xdr minTime=${minTime} no futuro (agora=${agoraSec})`);
  }
}

function fmtAsset(a: Asset): string {
  return a.isNative() ? 'native' : `${a.code}:${a.issuer}`;
}

export function assertSwapXdrMatchesQuote(
  xdr: string,
  expected: SwapXdrExpectation,
  opts?: { agoraSec?: number },
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

  assertJanelaDeValidade(tx, opts?.agoraSec ?? Math.floor(Date.now() / 1000));

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

  // Leg 2: issuer → investor, PLINARF (Sênior) ou PLINARFB (Subordinada).
  // N1: a subscrição EMITE token novo. Perna 2 vinda do distributor (venda da
  // tesouraria, que inflava o NAV) ou de qualquer outra conta é recusada —
  // inclusive sem source explícito, que herdaria o investidor.
  const plinarf = new Asset(
    expected.plinarfCode ?? assetCode,
    expected.issuerPubkey,
  );
  const op2Source = op2.source ?? tx.source;
  if (op2Source !== expected.issuerPubkey) {
    throw new Error(`leg2 source=${op2Source} ≠ issuer`);
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
