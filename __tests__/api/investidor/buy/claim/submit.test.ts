import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockUpdate, mockEventoAuditCreate, mockDbTransaction, mockSubmitWithPrivySignature } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockEventoAuditCreate: vi.fn(),
    mockDbTransaction: vi.fn(),
    mockSubmitWithPrivySignature: vi.fn(),
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
    onRampOrder: { findUnique: mockFindUnique, update: mockUpdate },
    eventoAudit: { create: mockEventoAuditCreate },
    $transaction: mockDbTransaction,
  },
}));

vi.mock('@/lib/stellar/transactions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/transactions')>(
    '@/lib/stellar/transactions',
  );
  return { ...actual, submitWithPrivySignature: mockSubmitWithPrivySignature };
});

import { POST } from '@/app/api/investidor/buy/claim/submit/route';

function req(body: object): Request {
  return new Request('http://x/claim/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_BODY = { orderId: 'order-x', xdr: 'AAAA', signatureHex: '0xsig' };

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockEventoAuditCreate.mockReset().mockResolvedValue(undefined);
  mockDbTransaction.mockReset().mockImplementation(async (fn) =>
    fn({
      onRampOrder: { update: mockUpdate },
      eventoAudit: { create: mockEventoAuditCreate },
    }),
  );
  mockSubmitWithPrivySignature.mockReset().mockResolvedValue({ hash: 'tx_claim_xyz' });
});

describe('POST /api/investidor/buy/claim/submit (PLINA-MOD-007)', () => {
  it('400 sem orderId', async () => {
    const { orderId: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('400 sem xdr', async () => {
    const { xdr: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('400 sem signatureHex', async () => {
    const { signatureHex: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('404 order inexistente', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(404);
  });

  it('403 ownership mismatch', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'OUTRO',
      claimTxHash: null,
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(403);
  });

  it('200 idempotente: claimTxHash já existe → retorna sem chamar submit', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'inv_1',
      claimTxHash: 'tx_existente',
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.claimTxHash).toBe('tx_existente');
    expect(json.idempotent).toBe(true);
    expect(mockSubmitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('200 happy: submete, persiste claimTxHash, audita CLAIMABLE_BALANCE_RESGATADA', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'inv_1',
      claimTxHash: null,
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.claimTxHash).toBe('tx_claim_xyz');
    expect(mockSubmitWithPrivySignature).toHaveBeenCalledWith({
      xdr: 'AAAA',
      investorPubkey: 'GABC',
      investorSignatureHex: '0xsig',
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-x' },
        data: expect.objectContaining({ claimTxHash: 'tx_claim_xyz' }),
      }),
    );
    expect(mockEventoAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acao: 'CLAIMABLE_BALANCE_RESGATADA',
          investidorId: 'inv_1',
          privyId: 'did:privy:abc',
          stellarTxHash: 'tx_claim_xyz',
        }),
      }),
    );
  });
});
