import { describe, it, expect, vi, beforeEach } from 'vitest';

const { quoteCreate, getQuote } = vi.hoisted(() => ({
  quoteCreate: vi.fn(),
  getQuote: vi.fn(),
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
  db: { quote: { create: quoteCreate } },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    getQuote = getQuote;
  },
}));

process.env.ETHERFUSE_API_KEY = 'test';

import { POST } from '@/app/api/investidor/quote/route';

function req(body: object): Request {
  return new Request('http://x/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  quoteCreate.mockReset().mockResolvedValue({});
  getQuote.mockReset().mockResolvedValue({
    id: 'q_1',
    fromCurrency: 'BRL',
    fromAmount: '100',
    toCurrency: 'TESOURO',
    toAmount: '99.5',
    exchangeRate: '0.995',
    fee: '0.5',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  });
});

describe('POST /api/investidor/quote', () => {
  it('400 sem campos obrigatórios', async () => {
    const r = await POST(req({ amountBrl: '100' }));
    expect(r.status).toBe(400);
  });

  it('403 quando customerId não casa', async () => {
    const r = await POST(
      req({ amountBrl: '100', customerId: 'OUTRO', stellarAddress: 'GABC' }),
    );
    expect(r.status).toBe(403);
  });

  it('403 quando stellarAddress não casa', async () => {
    const r = await POST(
      req({ amountBrl: '100', customerId: 'cust_1', stellarAddress: 'GOUTRO' }),
    );
    expect(r.status).toBe(403);
  });

  it('200 happy path persiste o quote com user.investidorId', async () => {
    const r = await POST(
      req({ amountBrl: '100', customerId: 'cust_1', stellarAddress: 'GABC' }),
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.quoteId).toBe('q_1');
    expect(quoteCreate).toHaveBeenCalledOnce();
    expect(quoteCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
  });
});
