import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Asset, Keypair, Operation, Transaction } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import { networkPassphrase } from '@/lib/stellar/config';

// Builder, validador e verificação da assinatura do issuer REAIS, juntos:
// o XDR que o build monta é o que o submit aceita (e só ele).
const USER = Keypair.random();
const ISSUER = Keypair.random();
const DIST = Keypair.random();
const BRIDGE = { code: 'TESOURO', issuer: Keypair.random().publicKey() };

const m = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  submitWithPrivySignature: vi.fn(),
  loadAccount: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (h: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) => (req: Request) =>
    h(req, { user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: USER.publicKey() } }),
}));
vi.mock('@/lib/db', () => {
  const tx = {
    quote: { updateMany: m.quoteUpdateMany },
    investidor: { update: vi.fn() },
    eventoAudit: { create: vi.fn() },
    movimentoFundo: { createMany: vi.fn(async () => ({ count: 1 })) },
    holdingPLINARF: { upsert: vi.fn() },
  };
  return { db: { quote: { findUnique: m.quoteFindUnique, updateMany: m.quoteUpdateMany, findFirst: async () => null }, $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } };
});
vi.mock('@/lib/stellar/account', () => ({
  horizon: { loadAccount: m.loadAccount },
  buildAsset: (issuer: string, code: string) => new Asset(code, issuer),
}));
vi.mock('@/lib/stellar/fee', () => ({ getDynamicFee: async () => '100' }));
vi.mock('@/lib/stellar/transactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/transactions')>();
  return {
    ...actual,
    submitWithPrivySignature: m.submitWithPrivySignature,
    txHashFromXdr: () => 'tx_hash',
    fetchTransactionByHash: async () => null,
  };
});
vi.mock('@/lib/stellar/signer', () => ({
  issuerSigner: () => ({
    publicKey: () => ISSUER.publicKey(),
    signatureBase64: (tx: Transaction) => ISSUER.sign(tx.hash()).toString('base64'),
  }),
}));
vi.mock('@/lib/services/emissao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/emissao')>();
  return { ...actual, revalidarNavDaCotacao: async () => undefined };
});
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline: vi.fn() }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({
  resolveTesouroAsset: async () => ({ ...BRIDGE, identifier: `${BRIDGE.code}:${BRIDGE.issuer}` }),
}));

import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { POST } from '@/app/api/investidor/buy/swap/submit/route';

function quote() {
  return {
    id: 'q_1', investidorId: 'inv_1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    fromAmount: new Prisma.Decimal('400'), toAmount: new Prisma.Decimal('344'),
    navPorTokenNaCotacao: new Prisma.Decimal('1.0625'), plinarfAmount: new Prisma.Decimal('376.4705882'),
    classe: null, investidor: { publicKey: USER.publicKey() },
    onRampOrder: { id: 'ord_1', status: 'completed', paymentInstructionsJson: {} },
  };
}
const req = (body: object) =>
  new Request('http://x/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function build() {
  m.loadAccount.mockResolvedValue(
    // N1-at: investidor com trustline PLINARF autorizada.
    Object.assign(new Account(USER.publicKey(), '10'), {
      balances: [{ asset_type: 'credit_alphanum12', asset_code: 'PLINARF', asset_issuer: ISSUER.publicKey(), balance: '0', is_authorized: true }],
    }),
  );
  return buildSwapBridgeForPlinarfXdr({
    investorPubkey: USER.publicKey(),
    bridgeAsset: new Asset(BRIDGE.code, BRIDGE.issuer),
    bridgeAmount: '344.0000000',
    plinarfAmount: '376.4705882',
    issuerPubkey: ISSUER.publicKey(),
    distributorPubkey: DIST.publicKey(),
    plinarfCode: 'PLINARF',
    memo: 'q:q_1',
  });
}

beforeEach(() => {
  process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST.publicKey();
  m.quoteFindUnique.mockReset().mockResolvedValue(quote());
  m.quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  m.submitWithPrivySignature.mockReset().mockResolvedValue({ hash: 'tx_hash' });
});

const signedBy = (xdr: string, kp: Keypair) => {
  const tx = new Transaction(xdr, networkPassphrase);
  tx.sign(kp);
  return tx.toXDR();
};

describe('N1 — subscrição emite: builder + validador + assinatura da Plina só no submit', () => {
  it('a perna 2 montada pelo build sai do ISSUER; o ponte vai ao distributor; sem assinatura da Plina', async () => {
    const { xdr } = await build();
    const tx = new Transaction(xdr, networkPassphrase);
    const [leg1, leg2] = tx.operations as Operation.Payment[];
    expect(leg1.destination).toBe(DIST.publicKey());
    expect(leg2.source).toBe(ISSUER.publicKey());
    expect(leg2.destination).toBe(USER.publicKey());
    expect(leg2.amount).toBe('376.4705882');
    expect(tx.signatures).toHaveLength(0); // o build não assina nada
  });

  it('submit aceita o XDR do build assinado pelo investidor e o issuer co-assina SÓ ali (assinatura válida sobre o hash)', async () => {
    const { xdr } = await build();
    const r = await POST(req({ quoteId: 'q_1', signedXdr: signedBy(xdr, USER) }));
    expect(r.status).toBe(200);
    const arg = m.submitWithPrivySignature.mock.calls[0][0];
    const hash = new Transaction(xdr, networkPassphrase).hash();
    expect(arg.extraSignatures).toHaveLength(1);
    expect(arg.extraSignatures[0].pubkey).toBe(ISSUER.publicKey());
    expect(ISSUER.verify(hash, Buffer.from(arg.extraSignatures[0].sigBase64, 'base64'))).toBe(true);
    expect(USER.verify(hash, Buffer.from(arg.investorSignatureHex.slice(2), 'hex'))).toBe(true);
    expect(new Transaction(arg.xdr, networkPassphrase).signatures).toHaveLength(0);
  });

  it('submit recusa XDR não assinado pelo investidor e assinado por outro: o issuer não assina', async () => {
    const { xdr } = await build();
    for (const signed of [xdr, signedBy(xdr, DIST), signedBy(xdr, Keypair.random())]) {
      const r = await POST(req({ quoteId: 'q_1', signedXdr: signed }));
      expect(r.status).toBe(400);
    }
    expect(m.submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('submit recusa um XDR cuja perna 2 sai do distributor (desenho antigo), mesmo assinado pelo investidor', async () => {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const velho = new TransactionBuilder(new Account(USER.publicKey(), '10'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER.publicKey(), destination: DIST.publicKey(), asset: new Asset(BRIDGE.code, BRIDGE.issuer), amount: '344.0000000' }))
      .addOperation(Operation.payment({ source: DIST.publicKey(), destination: USER.publicKey(), asset: new Asset('PLINARF', ISSUER.publicKey()), amount: '376.4705882' }))
      .setTimeout(60).build();
    velho.sign(USER);
    const r = await POST(req({ quoteId: 'q_1', signedXdr: velho.toXDR() }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/xdr divergente/);
    expect(m.submitWithPrivySignature).not.toHaveBeenCalled();
  });
});
