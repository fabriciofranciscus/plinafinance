import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, getOnRampTransaction } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getOnRampTransaction: vi.fn(),
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
          publicKey: 'GABC',
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: { onRampOrder: { findUnique } },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    getOnRampTransaction = getOnRampTransaction;
  },
}));

process.env.ETHERFUSE_API_KEY = 'test';

import { GET } from '@/app/api/investidor/buy/onramp/status/route';

function req(qs: string): Request {
  return new Request(`http://x/status${qs}`, { method: 'GET' });
}

beforeEach(() => {
  findUnique.mockReset();
  getOnRampTransaction.mockReset();
});

describe('GET /api/investidor/buy/onramp/status', () => {
  it('400 sem orderId', async () => {
    const r = await GET(req(''));
    expect(r.status).toBe(400);
  });

  it('404 quando order não existe', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await GET(req('?orderId=missing'));
    expect(r.status).toBe(404);
  });

  it('403 quando order é de outro investidor', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'ord_1',
      investidorId: 'inv_OUTRO',
      status: 'pending',
      stellarTxHash: null,
      paymentInstructionsJson: { __mock: false },
      settledAt: null,
    });
    const r = await GET(req('?orderId=ord_1'));
    expect(r.status).toBe(403);
  });

  it('200 happy path mock — não chama Etherfuse', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'ord_1',
      investidorId: 'inv_1',
      status: 'pending',
      stellarTxHash: null,
      paymentInstructionsJson: { __mock: true, pixKey: 'fake' },
      settledAt: null,
    });
    const r = await GET(req('?orderId=ord_1'));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.mock).toBe(true);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });
});
