import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();

const {
  submitWithPrivySignature,
  authorizeTrustline,
  assertElegivelParaTrustline,
  investidorFindUnique,
  investidorUpdate,
  eventoAuditFindFirst,
  eventoAuditCreate,
} = vi.hoisted(() => ({
  submitWithPrivySignature: vi.fn(),
  authorizeTrustline: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  investidorFindUnique: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditFindFirst: vi.fn(),
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
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    investidor: { findUnique: investidorFindUnique, update: investidorUpdate },
    eventoAudit: {
      findFirst: eventoAuditFindFirst,
      create: eventoAuditCreate,
    },
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
  investorPubkey: USER_PK,
  signatureHex: 'a1b2c3d4',
};

beforeEach(() => {
  process.env.STELLAR_ISSUER_SECRET = 'SISSUER';
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_trust_hash' });
  authorizeTrustline.mockReset().mockResolvedValue({ hash: 'tx_auth_hash' });
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
  investidorFindUnique.mockReset().mockResolvedValue({ trustlineTxHash: null });
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditFindFirst.mockReset().mockResolvedValue(null);
  eventoAuditCreate.mockReset().mockResolvedValue({});
});

describe('POST /api/investidor/buy/trust-plinarf/submit', () => {
  it('400 input faltando', async () => {
    const r = await POST(req({ xdr: 'X' }));
    expect(r.status).toBe(400);
  });

  it('403 pubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, investorPubkey: OTHER_PK }));
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
    const json = await r.json();
    expect(json.trustlineTxHash).toBe('tx_trust_hash');
    expect(json.authorizeTxHash).toBe('tx_auth_hash');
    expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    expect(authorizeTrustline).toHaveBeenCalledOnce();
    expect(investidorUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { trustlineTxHash: 'tx_trust_hash' },
    });
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe(
      'TRUSTLINE_AUTORIZADA',
    );
  });

  it('F-11: retry após sucesso completo retorna hashes existentes (idempotente)', async () => {
    investidorFindUnique.mockResolvedValueOnce({
      trustlineTxHash: 'existing_trust',
    });
    eventoAuditFindFirst.mockResolvedValueOnce({
      stellarTxHash: 'existing_auth',
      payloadJson: {},
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.trustlineTxHash).toBe('existing_trust');
    expect(json.authorizeTxHash).toBe('existing_auth');
    expect(json.idempotent).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(authorizeTrustline).not.toHaveBeenCalled();
  });

  it('F-11: retry após falha de authorize executa só authorize (skip trustline)', async () => {
    investidorFindUnique.mockResolvedValueOnce({
      trustlineTxHash: 'existing_trust',
    });
    eventoAuditFindFirst.mockResolvedValueOnce(null);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.trustlineTxHash).toBe('existing_trust');
    expect(json.authorizeTxHash).toBe('tx_auth_hash');
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(authorizeTrustline).toHaveBeenCalledOnce();
    expect(investidorUpdate).not.toHaveBeenCalled();
  });

  it('F-11: persiste trustlineTxHash ANTES de chamar authorize', async () => {
    const callOrder: string[] = [];
    submitWithPrivySignature.mockImplementationOnce(async () => {
      callOrder.push('submitTrustline');
      return { hash: 'tx_trust_hash' };
    });
    investidorUpdate.mockImplementationOnce(async () => {
      callOrder.push('persistTrustline');
      return {};
    });
    authorizeTrustline.mockImplementationOnce(async () => {
      callOrder.push('authorize');
      return { hash: 'tx_auth_hash' };
    });
    await POST(req(FULL_BODY));
    expect(callOrder).toEqual([
      'submitTrustline',
      'persistTrustline',
      'authorize',
    ]);
  });
});
