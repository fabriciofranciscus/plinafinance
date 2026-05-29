import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();

const {
  quoteFindUnique,
  quoteUpdateMany,
  investidorUpdate,
  eventoAuditCreate,
  buildSwapBridgeForPlinarfXdr,
  preSignWithSigner,
  distribute,
  buildAsset,
  resolveTesouroAsset,
  assertElegivelParaTrustline,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  buildSwapBridgeForPlinarfXdr: vi.fn(),
  preSignWithSigner: vi.fn(),
  distribute: vi.fn(),
  buildAsset: vi.fn(),
  resolveTesouroAsset: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (
    handler: (
      req: Request,
      ctx: { user: Record<string, unknown> },
    ) => Promise<Response>,
  ) =>
    (req: Request) =>
      handler(req, {
        user: {
          privyId: 'did:privy:abc',
          investidorId: 'inv_1',
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: quoteFindUnique },
    $transaction: async (
      cb: (tx: {
        quote: { updateMany: typeof quoteUpdateMany };
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        quote: { updateMany: quoteUpdateMany },
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/stellar/transactions', () => ({
  buildSwapBridgeForPlinarfXdr,
  preSignWithSigner,
}));
vi.mock('@/lib/stellar/issuer', () => ({ distribute }));
vi.mock('@/lib/stellar/account', () => ({ buildAsset }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));

process.env.STELLAR_ISSUER_PUBLIC = 'GISSUER';
process.env.STELLAR_DISTRIBUTOR_SECRET = 'SDIST';
process.env.STELLAR_DISTRIBUTOR_PUBLIC = 'GDIST';

import { POST } from '@/app/api/investidor/buy/swap/build/route';

function req(body: object): Request {
  return new Request('http://x/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    toAmount: new Prisma.Decimal('99.5'),
    investidor: { publicKey: USER_PK },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: { __mock: true },
    },
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  distribute.mockReset().mockResolvedValue({ hash: 'tx_mock_hash' });
  buildSwapBridgeForPlinarfXdr.mockReset();
  preSignWithSigner.mockReset();
  buildAsset.mockReset().mockReturnValue({});
  resolveTesouroAsset.mockReset();
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/investidor/buy/swap/build', () => {
  it('400 sem campos obrigatórios', async () => {
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(400);
  });

  it('403 quando investorPubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: OTHER_PK }));
    expect(r.status).toBe(403);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(403);
  });

  it('409 quote já consumido', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ consumedAt: new Date() }));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(409);
  });

  it('200 mock path executa distribute + audit log', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.mock).toBe(true);
    expect(json.alreadyExecuted).toBe(true);
    expect(json.txHash).toBe('tx_mock_hash');
    expect(distribute).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(true);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
