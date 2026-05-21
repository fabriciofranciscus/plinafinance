import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitWithPrivySignature, investidorUpdate, eventoAuditCreate } =
  vi.hoisted(() => ({
    submitWithPrivySignature: vi.fn(),
    investidorUpdate: vi.fn(),
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
    $transaction: async (
      cb: (tx: {
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/stellar/transactions', () => ({ submitWithPrivySignature }));

import { POST } from '@/app/api/investidor/buy/trust-tesouro/submit/route';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_BODY = {
  xdr: 'AAAA',
  investorPubkey: 'GABC',
  signatureHex: '0xsig',
};

beforeEach(() => {
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_tesouro_hash' });
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
});

describe('POST /api/investidor/buy/trust-tesouro/submit', () => {
  it('400 input faltando', async () => {
    const r = await POST(req({ xdr: 'X' }));
    expect(r.status).toBe(400);
  });

  it('403 pubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, investorPubkey: 'GOUTRO' }));
    expect(r.status).toBe(403);
  });

  it('200 happy path grava tesouro tx + audit', async () => {
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(investidorUpdate.mock.calls[0][0].data.tesouroTrustlineTxHash).toBe(
      'tx_tesouro_hash',
    );
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe(
      'TESOURO_TRUSTLINE_AUTORIZADA',
    );
    expect(eventoAuditCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
  });

  it('200 sem fallback por pubkey — sempre usa user.investidorId', async () => {
    // Mesmo cenário do happy path; o teste explicita que NÃO há lookup por
    // publicKey (gap antigo da rota — fechado neste PR).
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
  });
});
