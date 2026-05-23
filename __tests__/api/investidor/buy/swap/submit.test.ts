import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  quoteFindUnique,
  quoteUpdateMany,
  investidorUpdate,
  eventoAuditCreate,
  submitWithPrivySignature,
  assertElegivelParaTrustline,
  assertSwapXdrMatchesQuote,
  resolveTesouroAsset,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  submitWithPrivySignature: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  assertSwapXdrMatchesQuote: vi.fn(),
  resolveTesouroAsset: vi.fn(),
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
    quote: { findUnique: quoteFindUnique, updateMany: quoteUpdateMany },
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
vi.mock('@/lib/stellar/parse-swap-xdr', () => ({ assertSwapXdrMatchesQuote }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

const SAVED_ISSUER = process.env.STELLAR_ISSUER_PUBLIC;
process.env.STELLAR_ISSUER_PUBLIC = 'GISSUER';

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
  assertSwapXdrMatchesQuote.mockReset();
  resolveTesouroAsset
    .mockReset()
    .mockResolvedValue({
      code: 'TESOURO',
      issuer: 'GTESOURO',
      identifier: 'TESOURO:GTESOURO',
    });
  process.env.STELLAR_ISSUER_PUBLIC = SAVED_ISSUER ?? 'GISSUER';
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

  it('C-04: retry após sucesso com mesmo XDR → 200 idempotente sem re-submit', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: 'fe73463a59d79cb4609d5f18447ed88de5be0352298d9c24e55c56297122c5fd', // sha256("AAAA...")
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_prev');
    expect(json.idempotent).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-04: quote consumido com XDR diferente → 409', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: 'hash_de_outra_xdr',
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-01: 400 quando XDR diverge do quote (amount inflado)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    assertSwapXdrMatchesQuote.mockImplementationOnce(() => {
      throw new Error('leg2 amount=999.0000000 ≠ esperado=99.5000000');
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toMatch(/xdr divergente/);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('200 happy path consome quote + incrementa saldo + audit', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_real_hash');
    expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    // C-04: updateMany chamado 2x — reserve (submitXdrHash:null) + consume.
    expect(quoteUpdateMany).toHaveBeenCalledTimes(2);
    expect(quoteUpdateMany.mock.calls[0][0].where.submitXdrHash).toBeNull();
    expect(quoteUpdateMany.mock.calls[1][0].where.consumedAt).toBeNull();
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(false);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
