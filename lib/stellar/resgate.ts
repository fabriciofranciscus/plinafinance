/**
 * E2-4 — XDR do resgate com queima (SOW E2).
 *
 * Uma tx, duas pernas, atômica (ou as duas entram, ou nenhuma):
 *   perna 1: investidor → ISSUER, PLINARF(B) — pagar ao issuer destrói o token
 *            (queima): o supply cai junto com a saída de caixa;
 *   perna 2: distributor → investidor, ativo-ponte (TESOURO) ao NAV.
 * Source da tx = investidor (paga fee). Assinam investidor + distributor; o
 * issuer não assina (a queima é um pagamento do holder). A Plina (distributor)
 * só assina no submit, depois de validar com `assertResgateXdrMatchesQuote`.
 *
 * Antes (MVP) o PLINARF voltava ao distributor e ficava "revendável": o
 * caixa saía e o supply não caía, e o NAV despencava a cada resgate.
 *
 * Contrato: contratos/2026-11-11-e2-4-resgate-xdr.md.
 */
import { Asset, Memo, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildAsset, horizon } from './account';
import { STELLAR_TX_TIMEOUT_SEC, networkPassphrase } from './config';
import { assetCodeForClasse } from './classes';
import { getDynamicFee } from './fee';
import { assertSemPrecondicoesV2 } from './parse-swap-xdr';
import { exigirTrustlineAutorizada } from './trustline';

export type ResgateErrorCode = 'RESGATE_ENTRADA_INVALIDA';

export class ResgateInputError extends Error {
  readonly code: ResgateErrorCode = 'RESGATE_ENTRADA_INVALIDA';
  /** Qual campo: 'plinarfAmount' | 'bridgeAmount' | 'memoHash' | 'plinarfCode'. */
  readonly campo: string;

  constructor(campo: string) {
    super('Resgate recusado: entrada inválida.');
    this.name = 'ResgateInputError';
    this.campo = campo;
  }
}

/** Amount Stellar: > 0, até 7 casas, dentro do máximo int64 em stroops. */
const AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;
const MAX_STROOPS = BigInt('9223372036854775807');

function stroops(amount: string): bigint {
  const [i, f = ''] = amount.split('.');
  return BigInt(i) * BigInt(10_000_000) + BigInt(f.padEnd(7, '0'));
}

function amountValido(v: unknown): v is string {
  if (typeof v !== 'string' || !AMOUNT.test(v)) return false;
  const s = stroops(v);
  return s > BigInt(0) && s <= MAX_STROOPS;
}

function codesDaPlina(): string[] {
  return [assetCodeForClasse('SENIOR'), assetCodeForClasse('SUBORDINADA')];
}

/** Normaliza para o formato do `op.amount` (7 casas). */
function sete(amount: string): string {
  const [i, f = ''] = amount.split('.');
  return `${BigInt(i).toString()}.${f.padEnd(7, '0')}`;
}

export async function buildResgateXdr(input: {
  investorPubkey: string;
  issuerPubkey: string;
  distributorPubkey: string;
  bridgeAsset: Asset;
  plinarfCode: string;
  plinarfAmount: string;
  bridgeAmount: string;
  memoHash?: Buffer;
}): Promise<{ xdr: string; hashHex: string; maxTime: number }> {
  if (!codesDaPlina().includes(input.plinarfCode)) throw new ResgateInputError('plinarfCode');
  if (!amountValido(input.plinarfAmount)) throw new ResgateInputError('plinarfAmount');
  if (!amountValido(input.bridgeAmount)) throw new ResgateInputError('bridgeAmount');
  if (input.memoHash !== undefined && (!Buffer.isBuffer(input.memoHash) || input.memoHash.length !== 32)) {
    throw new ResgateInputError('memoHash');
  }

  const account = await horizon.loadAccount(input.investorPubkey);
  // A perna 2 só entra se o investidor puder receber o ativo-ponte.
  exigirTrustlineAutorizada(
    (account as unknown as { balances?: [] }).balances,
    input.bridgeAsset.getCode(),
    input.bridgeAsset.getIssuer(),
    input.investorPubkey,
  );

  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        // Queima: o holder devolve ao issuer.
        source: input.investorPubkey,
        destination: input.issuerPubkey,
        asset: buildAsset(input.issuerPubkey, input.plinarfCode),
        amount: input.plinarfAmount,
      }),
    )
    .addOperation(
      Operation.payment({
        source: input.distributorPubkey,
        destination: input.investorPubkey,
        asset: input.bridgeAsset,
        amount: input.bridgeAmount,
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC);
  if (input.memoHash) builder.addMemo(Memo.hash(input.memoHash));

  const tx = builder.build();
  return {
    xdr: tx.toXDR(),
    hashHex: '0x' + tx.hash().toString('hex'),
    maxTime: Number(tx.timeBounds?.maxTime ?? 0),
  };
}

export interface ResgateXdrExpectation {
  investorPubkey: string;
  issuerPubkey: string;
  distributorPubkey: string;
  bridgeAsset: { code: string; issuer: string };
  plinarfCode: string;
  expectedPlinarfAmount: string;
  expectedBridgeAmount: string;
  memoHash?: Buffer;
}

function fmt(a: Asset): string {
  return a.isNative() ? 'native' : `${a.getCode()}:${a.getIssuer()}`;
}

/**
 * Confere o XDR assinado pelo investidor contra o pedido de resgate, antes
 * de a Plina (distributor) assinar. Lança `Error` com a perna divergente.
 */
export function assertResgateXdrMatchesQuote(xdr: string, expected: ResgateXdrExpectation): void {
  if (!amountValido(expected.expectedPlinarfAmount) || !amountValido(expected.expectedBridgeAmount)) {
    throw new Error('expectativa de resgate inválida: amounts precisam ser > 0 com até 7 casas');
  }
  let tx: Transaction;
  try {
    tx = new Transaction(xdr, networkPassphrase);
  } catch {
    throw new Error('xdr inválida ou networkPassphrase divergente');
  }
  if (tx.source !== expected.investorPubkey) throw new Error(`xdr.source=${tx.source} ≠ investidor`);
  assertSemPrecondicoesV2(tx);
  if (tx.operations.length !== 2) {
    throw new Error(`xdr de resgate deve ter exatamente 2 ops, tem ${tx.operations.length}`);
  }
  const [op1, op2] = tx.operations;
  if (op1.type !== 'payment') throw new Error('leg1 não é payment');
  if (op2.type !== 'payment') throw new Error('leg2 não é payment');

  // Perna 1: queima — investidor → issuer, PLINARF(B).
  const plinarf = new Asset(expected.plinarfCode, expected.issuerPubkey);
  const s1 = op1.source ?? tx.source;
  if (s1 !== expected.investorPubkey) throw new Error(`leg1 source=${s1} ≠ investidor`);
  if (op1.destination !== expected.issuerPubkey) {
    throw new Error(`leg1 destination=${op1.destination} ≠ issuer (resgate queima; não volta ao distributor)`);
  }
  if (!op1.asset.equals(plinarf)) throw new Error(`leg1 asset=${fmt(op1.asset)} ≠ ${fmt(plinarf)}`);
  if (op1.amount !== sete(expected.expectedPlinarfAmount)) {
    throw new Error(`leg1 amount=${op1.amount} ≠ esperado=${sete(expected.expectedPlinarfAmount)}`);
  }

  // Perna 2: caixa — distributor → investidor, ativo-ponte.
  const bridge = new Asset(expected.bridgeAsset.code, expected.bridgeAsset.issuer);
  const s2 = op2.source ?? tx.source;
  if (s2 !== expected.distributorPubkey) throw new Error(`leg2 source=${s2} ≠ distributor`);
  if (op2.destination !== expected.investorPubkey) throw new Error(`leg2 destination=${op2.destination} ≠ investidor`);
  if (!op2.asset.equals(bridge)) throw new Error(`leg2 asset=${fmt(op2.asset)} ≠ ${fmt(bridge)}`);
  if (op2.amount !== sete(expected.expectedBridgeAmount)) {
    throw new Error(`leg2 amount=${op2.amount} ≠ esperado=${sete(expected.expectedBridgeAmount)}`);
  }

  if (expected.memoHash) {
    const ok =
      tx.memo.type === 'hash' && Buffer.from(tx.memo.value as Buffer).equals(expected.memoHash);
    if (!ok) throw new Error('xdr memo diferente do pedido de resgate');
  }
}
