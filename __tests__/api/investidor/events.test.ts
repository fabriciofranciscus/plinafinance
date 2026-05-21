import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

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
  db: { investidor: { findUnique } },
}));

import { GET } from '@/app/api/investidor/events/route';

function req(): Request {
  return new Request('http://x/events', { method: 'GET' });
}

beforeEach(() => {
  findUnique.mockReset();
});

describe('GET /api/investidor/events', () => {
  it('200 com investidorId null quando investidor sumiu entre guard e query', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await GET(req());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.investidorId).toBeNull();
    expect(json.events).toEqual([]);
  });

  it('200 com eventos vazios', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'inv_1',
      eventos: [],
    });
    const r = await GET(req());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.investidorId).toBe('inv_1');
    expect(json.events).toEqual([]);
  });

  it('200 com eventos mapeados', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'inv_1',
      eventos: [
        {
          id: 'ev_1',
          acao: 'INVESTIDOR_ONBOARDED',
          criadoEm: new Date('2026-05-01').toISOString(),
          stellarTxHash: 'abc',
          motivoClawback: null,
          fundamentoUrl: null,
          payloadJson: { foo: 'bar' },
        },
      ],
    });
    const r = await GET(req());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0]).toMatchObject({
      id: 'ev_1',
      acao: 'INVESTIDOR_ONBOARDED',
      stellarTxHash: 'abc',
      payload: { foo: 'bar' },
    });
  });
});
