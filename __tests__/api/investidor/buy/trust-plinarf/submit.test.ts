import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  submitWithPrivySignature,
  authorizeTrustline,
  assertElegivelParaTrustline,
  investidorUpdate,
  eventoAuditCreate,
} = vi.hoisted(() => ({
  submitWithPrivySignature: vi.fn(),
  authorizeTrustline: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
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
vi.mock('@/lib/stellar/issuer', () => ({ authorizeTrustline }));
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));

const SAVED_SECRET = process.env.STELLAR_ISSUER_SECRET;
process.env.STELLAR_ISSUER_SECRET = 'SISSUER';

import { POST } from '@/app/api/investidor/buy/trust-plinarf/submit/route';

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
  process.env.STELLAR_ISSUER_SECRET = 'SISSUER';
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_trust_hash' });
  authorizeTrustline.mockReset().mockResolvedValue({ hash: 'tx_auth_hash' });
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
});

describe('POST /api/investidor/buy/trust-plinarf/submit', () => {
  it('400 input faltando', async () => {
    const r = await POST(req({ xdr: 'X' }));
    expect(r.status).toBe(400);
  });

  it('403 pubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, investorPubkey: 'GOUTRO' }));
    expect(r.status).toBe(403);
  });

  it('500 quando STELLAR_ISSUER_SECRET ausente', async () => {
    delete process.env.STELLAR_ISSUER_SECRET;
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    process.env.STELLAR_ISSUER_SECRET = SAVED_SECRET ?? 'SISSUER';
  });

  it('200 happy path grava audit com user.investidorId', async () => {
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe(
      'TRUSTLINE_AUTORIZADA',
    );
    expect(eventoAuditCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });
});
