import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  quoteFindUnique,
  quoteUpdateMany,
  investidorUpdate,
  eventoAuditCreate,
  submitWithPrivySignature,
  assertElegivelParaTrustline,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  submitWithPrivySignature: vi.fn(),
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

vi.mock('@/lib/stellar/transactions', () => ({ submitWithPrivySignature }));
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));

import { POST } from '@/app/api/investidor/buy/swap/submit/route';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_BODY = {
  quoteId: 'q_1',
  investorPubkey: 'GABC',
  signatureHex: '0xdead',
  xdr: 'AAAA...',
  distributorSigBase64: 'sig==',
  distributorPubkey: 'GDIST',
};

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    toAmount: new Prisma.Decimal('99.5'),
    investidor: { publicKey: 'GABC' },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: {},
    },
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_real_hash' });
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/investidor/buy/swap/submit', () => {
  it('400 faltando campos', async () => {
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(400);
  });

  it('403 investorPubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, investorPubkey: 'GOUTRO' }));
    expect(r.status).toBe(403);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(403);
  });

  it('409 quando onramp não está completed', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        onRampOrder: { id: 'ord_1', status: 'pending', paymentInstructionsJson: {} },
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
  });

  it('200 happy path consome quote + incrementa saldo + audit', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_real_hash');
    expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    expect(quoteUpdateMany).toHaveBeenCalledOnce();
    expect(quoteUpdateMany.mock.calls[0][0].where.consumedAt).toBeNull();
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(false);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
