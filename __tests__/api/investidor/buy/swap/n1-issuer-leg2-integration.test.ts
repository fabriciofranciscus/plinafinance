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
  return { db: { quote: { findUnique: m.quoteFindUnique, updateMany: m.quoteUpdateMany }, $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } };
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
  m.loadAccount.mockResolvedValue(new Account(USER.publicKey(), '10'));
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

describe('N1 — subscrição emite: builder + validador + assinatura do issuer', () => {
  it('a perna 2 montada pelo build sai do ISSUER; o ponte vai ao distributor', async () => {
    const { xdr } = await build();
    const tx = new Transaction(xdr, networkPassphrase);
    const [leg1, leg2] = tx.operations as Operation.Payment[];
    expect(leg1.destination).toBe(DIST.publicKey());
    expect(leg2.source).toBe(ISSUER.publicKey());
    expect(leg2.destination).toBe(USER.publicKey());
    expect(leg2.amount).toBe('376.4705882');
  });

  it('submit aceita o XDR do build com a assinatura do issuer e submete com o issuer do env', async () => {
    const { xdr } = await build();
    const sig = ISSUER.sign(new Transaction(xdr, networkPassphrase).hash()).toString('base64');
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER.publicKey(), signatureHex: 'a'.repeat(128), xdr, issuerSigBase64: sig }));
    expect(r.status).toBe(200);
    expect(m.submitWithPrivySignature.mock.calls[0][0].extraSignatures).toEqual([{ pubkey: ISSUER.publicKey(), sigBase64: sig }]);
  });

  it('submit recusa assinatura do DISTRIBUTOR no lugar da do issuer (quem entrega o PLINARF não pode ser o distributor)', async () => {
    const { xdr } = await build();
    const sigDist = DIST.sign(new Transaction(xdr, networkPassphrase).hash()).toString('base64');
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER.publicKey(), signatureHex: 'a'.repeat(128), xdr, issuerSigBase64: sigDist }));
    expect(r.status).toBe(400);
    expect(m.submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('submit recusa um XDR cuja perna 2 sai do distributor (desenho antigo), mesmo com assinatura válida do issuer', async () => {
    const { xdr } = await build();
    void xdr;
    // desenho antigo: perna 2 com source = distributor
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const velho = new TransactionBuilder(new Account(USER.publicKey(), '10'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER.publicKey(), destination: DIST.publicKey(), asset: new Asset(BRIDGE.code, BRIDGE.issuer), amount: '344.0000000' }))
      .addOperation(Operation.payment({ source: DIST.publicKey(), destination: USER.publicKey(), asset: new Asset('PLINARF', ISSUER.publicKey()), amount: '376.4705882' }))
      .setTimeout(60).build();
    const sig = ISSUER.sign(velho.hash()).toString('base64');
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER.publicKey(), signatureHex: 'a'.repeat(128), xdr: velho.toXDR(), issuerSigBase64: sig }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/xdr divergente/);
    expect(m.submitWithPrivySignature).not.toHaveBeenCalled();
  });
});
