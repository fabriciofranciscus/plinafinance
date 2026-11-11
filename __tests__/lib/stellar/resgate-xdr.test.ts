import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  ResgateInputError,
  assertResgateXdrMatchesQuote,
  buildResgateXdr,
  type ResgateXdrExpectation,
} from '@/lib/stellar/resgate';
import { TrustlineNaoAutorizadaError } from '@/lib/stellar/trustline';

/** E2-4 — contrato: contratos/2026-11-11-e2-4-resgate-xdr.md. */
const INVESTOR = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const DISTRIBUTOR = Keypair.random().publicKey();
const OUTRA = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const PLINARF = new Asset('PLINARF', ISSUER);
const MEMO = createHash('sha256').update('plina:resgate:pedido-1').digest();

const PLINARF_AMOUNT = '376.4705882';
const BRIDGE_AMOUNT = '340.2300000';

const EXPECT: ResgateXdrExpectation = {
  investorPubkey: INVESTOR,
  issuerPubkey: ISSUER,
  distributorPubkey: DISTRIBUTOR,
  bridgeAsset: { code: TESOURO.getCode(), issuer: TESOURO.getIssuer() },
  plinarfCode: 'PLINARF',
  expectedPlinarfAmount: PLINARF_AMOUNT,
  expectedBridgeAmount: BRIDGE_AMOUNT,
  memoHash: MEMO,
  quoteExpiresAt: new Date(Date.now() + 5 * 60_000), // cotação de 5 min (E2-6)
};

function conta(balances: unknown[]) {
  return Object.assign(new Account(INVESTOR, '50'), { balances }) as never;
}
const trustTesouro = { asset_type: 'credit_alphanum12', asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), balance: '0', is_authorized: true };

beforeEach(() => {
  _resetFeeCacheForTests();
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([trustTesouro]));
});

function montar(over: Partial<Parameters<typeof buildResgateXdr>[0]> = {}) {
  return buildResgateXdr({
    investorPubkey: INVESTOR,
    issuerPubkey: ISSUER,
    distributorPubkey: DISTRIBUTOR,
    bridgeAsset: TESOURO,
    plinarfCode: 'PLINARF',
    plinarfAmount: PLINARF_AMOUNT,
    bridgeAmount: BRIDGE_AMOUNT,
    memoHash: MEMO,
    ...over,
  });
}

/** XDR montado à mão para os casos de fraude. */
function xdr(p: {
  dest1?: string; src1?: string; asset1?: Asset; amount1?: string;
  src2?: string; dest2?: string; asset2?: Asset; amount2?: string;
  memo?: Buffer | null; extraOp?: boolean; source?: string;
}): string {
  const b = new TransactionBuilder(new Account(p.source ?? INVESTOR, '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ source: p.src1 ?? INVESTOR, destination: p.dest1 ?? ISSUER, asset: p.asset1 ?? PLINARF, amount: p.amount1 ?? PLINARF_AMOUNT }))
    .addOperation(Operation.payment({ source: p.src2 ?? DISTRIBUTOR, destination: p.dest2 ?? INVESTOR, asset: p.asset2 ?? TESOURO, amount: p.amount2 ?? BRIDGE_AMOUNT }));
  if (p.extraOp) b.addOperation(Operation.bumpSequence({ bumpTo: '99' }));
  if (p.memo !== null) b.addMemo(Memo.hash(p.memo ?? MEMO));
  return b.setTimeout(60).build().toXDR();
}

describe('buildResgateXdr', () => {
  it('1 tx, 2 pernas: investidor → issuer (queima) e distributor → investidor (TESOURO)', async () => {
    const r = await montar();
    const tx = new Transaction(r.xdr, networkPassphrase);
    const [op1, op2] = tx.operations as Operation.Payment[];

    expect(tx.source).toBe(INVESTOR);
    expect(tx.operations).toHaveLength(2);
    expect(op1.source).toBe(INVESTOR);
    expect(op1.destination).toBe(ISSUER);
    expect(op1.asset.equals(PLINARF)).toBe(true);
    expect(op1.amount).toBe(PLINARF_AMOUNT);
    expect(op2.source).toBe(DISTRIBUTOR);
    expect(op2.destination).toBe(INVESTOR);
    expect(op2.asset.equals(TESOURO)).toBe(true);
    expect(op2.amount).toBe(BRIDGE_AMOUNT);
    expect(Buffer.from(tx.memo.value as Buffer).equals(MEMO)).toBe(true);
    expect(tx.signatures).toHaveLength(0); // a Plina não assina no build
    expect(r.maxTime).toBe(Number(tx.timeBounds?.maxTime));
  });

  it('o XDR do build passa no validador', async () => {
    const { xdr: x } = await montar();
    expect(() => assertResgateXdrMatchesQuote(x, EXPECT)).not.toThrow();
  });

  it('recusa entrada inválida antes de ir à rede', async () => {
    for (const [over, campo] of [
      [{ plinarfAmount: '0' }, 'plinarfAmount'],
      [{ plinarfAmount: '1.12345678' }, 'plinarfAmount'],
      [{ bridgeAmount: '-1' }, 'bridgeAmount'],
      [{ memoHash: Buffer.alloc(16) }, 'memoHash'],
      [{ plinarfCode: 'USDC' }, 'plinarfCode'],
    ] as const) {
      const err = await montar(over as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResgateInputError);
      expect((err as ResgateInputError).campo).toBe(campo);
    }
    expect(horizon.loadAccount).not.toHaveBeenCalled();
  });

  it('investidor sem trustline autorizada no ativo-ponte: recusa', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([{ ...trustTesouro, is_authorized: false }]));
    const err = await montar().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrustlineNaoAutorizadaError);
  });
});

describe('assertResgateXdrMatchesQuote — recusas', () => {
  const casos: Array<[string, Parameters<typeof xdr>[0], RegExp]> = [
    ['perna 1 volta ao distributor (revenda antiga, sem queima)', { dest1: DISTRIBUTOR }, /leg1 destination.*issuer/],
    ['perna 1 para outra conta', { dest1: OUTRA }, /leg1 destination/],
    ['perna 1 de outra conta', { src1: OUTRA }, /leg1 source/],
    ['perna 1 em outro asset', { asset1: new Asset('PLINARFB', ISSUER) }, /leg1 asset/],
    ['perna 1 queima menos', { amount1: '376.4705881' }, /leg1 amount/],
    ['perna 2 de outra conta', { src2: OUTRA }, /leg2 source/],
    ['perna 2 para outra conta', { dest2: OUTRA }, /leg2 destination/],
    ['perna 2 paga mais', { amount2: '340.2300001' }, /leg2 amount/],
    ['perna 2 em outro asset', { asset2: PLINARF }, /leg2 asset/],
    ['memo divergente', { memo: Buffer.alloc(32, 1) }, /memo/],
    ['sem memo', { memo: null }, /memo/],
    ['3 operações', { extraOp: true }, /2 ops/],
    ['source da tx ≠ investidor', { source: OUTRA }, /source/],
  ];
  for (const [nome, p, re] of casos) {
    it(nome, () => {
      expect(() => assertResgateXdrMatchesQuote(xdr(p), EXPECT)).toThrow(re);
    });
  }

  it('expectativa malformada é recusada antes de ler o XDR', () => {
    expect(() =>
      assertResgateXdrMatchesQuote(xdr({}), { ...EXPECT, expectedBridgeAmount: '0' }),
    ).toThrow(/expectativa/);
  });

  it('aceita expectativa sem casas decimais completas (normaliza para 7)', () => {
    const x = xdr({ amount1: '400', amount2: '340' });
    expect(() =>
      assertResgateXdrMatchesQuote(x, { ...EXPECT, expectedPlinarfAmount: '400', expectedBridgeAmount: '340.00' }),
    ).not.toThrow();
  });
});
