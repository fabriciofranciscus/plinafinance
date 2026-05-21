import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, update, eventoAuditCreate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  eventoAuditCreate: vi.fn(),
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
  db: {
    onRampOrder: { findUnique },
    $transaction: async (
      cb: (tx: {
        onRampOrder: { update: typeof update };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        onRampOrder: { update },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {},
}));

process.env.ETHERFUSE_API_KEY = 'test';
process.env.ETHERFUSE_ENV = 'sandbox';

import { POST } from '@/app/api/investidor/buy/onramp/sandbox-pay/route';

function req(body: object): Request {
  return new Request('http://x/sandbox-pay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ord_1',
    investidorId: 'inv_1',
    status: 'pending',
    stellarTxHash: null,
    paymentInstructionsJson: { __mock: true },
    settledAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
});

describe('POST /api/investidor/buy/onramp/sandbox-pay', () => {
  it('400 sem orderId', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('404 order inexistente', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ orderId: 'ord_x' }));
    expect(r.status).toBe(404);
  });

  it('403 order de outro investidor', async () => {
    findUnique.mockResolvedValueOnce(baseOrder({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req({ orderId: 'ord_1' }));
    expect(r.status).toBe(403);
  });

  it('200 idempotente quando já completed', async () => {
    findUnique.mockResolvedValueOnce(
      baseOrder({ status: 'completed', stellarTxHash: 'abc' }),
    );
    const r = await POST(req({ orderId: 'ord_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.status).toBe('completed');
    expect(update).not.toHaveBeenCalled();
  });

  it('200 mock pay flipa pra completed + grava ONRAMP_LIQUIDADA', async () => {
    findUnique.mockResolvedValueOnce(baseOrder());
    const r = await POST(req({ orderId: 'ord_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.status).toBe('completed');
    expect(json.stellarTxHash).toBe('mock-stellar-ord_1');
    expect(update).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('ONRAMP_LIQUIDADA');
    expect(eventoAuditCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
