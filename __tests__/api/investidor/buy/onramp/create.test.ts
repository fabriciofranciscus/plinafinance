import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { AnchorError } from '@/lib/anchors/types';

const { quoteFindUnique, onRampCreate, eventoAuditCreate, createOnRamp } =
  vi.hoisted(() => ({
    quoteFindUnique: vi.fn(),
    onRampCreate: vi.fn(),
    eventoAuditCreate: vi.fn(),
    createOnRamp: vi.fn(),
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
    quote: { findUnique: quoteFindUnique },
    $transaction: async (
      cb: (tx: {
        onRampOrder: { create: typeof onRampCreate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        onRampOrder: { create: onRampCreate },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    createOnRamp = createOnRamp;
  },
}));

process.env.ETHERFUSE_API_KEY = 'test';
process.env.ETHERFUSE_ENV = 'sandbox';

import { POST } from '@/app/api/investidor/buy/onramp/create/route';

function req(body: object): Request {
  return new Request('http://x/create', {
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
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: new Prisma.Decimal('100'),
    investidor: {
      etherfuseCustomerId: 'cust_1',
      publicKey: 'GABC',
    },
    onRampOrder: null,
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  onRampCreate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  createOnRamp.mockReset();
});

describe('POST /api/investidor/buy/onramp/create', () => {
  it('400 sem quoteId', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(403);
  });

  it('200 idempotente devolve order existente', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        onRampOrder: {
          id: 'ord_existing',
          status: 'pending',
          paymentInstructionsJson: { __mock: true },
        },
      }),
    );
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.orderId).toBe('ord_existing');
    expect(onRampCreate).not.toHaveBeenCalled();
  });

  it('200 happy path mock cria order com user.investidorId', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(
      new AnchorError('proxy account not found', 'BANK_ACCOUNT_MISSING'),
    );
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.mock).toBe(true);
    expect(onRampCreate).toHaveBeenCalledOnce();
    expect(onRampCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
