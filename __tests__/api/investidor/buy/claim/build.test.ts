import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Transaction } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';

const INVESTOR_PUBKEY = 'GCV34BIZKP6ATAOI3RTQQ7CRL5KOP3XCEEYQYB3ZD654CMO6XNJQQ5TQ';
const BALANCE_ID =
  '00000000618ee983898fa615b366c1efa396864d5f05808bc91ea0467eb0f0bf360a9af3';

const { mockFindUnique, mockLoadAccount } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadAccount: vi.fn(),
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
          publicKey: INVESTOR_PUBKEY,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: { onRampOrder: { findUnique: mockFindUnique } },
}));

vi.mock('@/lib/stellar/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/account')>(
    '@/lib/stellar/account',
  );
  return { ...actual, horizon: { loadAccount: mockLoadAccount } };
});

import { POST } from '@/app/api/investidor/buy/claim/build/route';

function req(body: object): Request {
  return new Request('http://x/claim/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockLoadAccount.mockReset().mockResolvedValue(new Account(INVESTOR_PUBKEY, '12345'));
});

describe('POST /api/investidor/buy/claim/build (PLINA-MOD-007)', () => {
  it('400 sem orderId', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('404 order inexistente', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(404);
  });

  it('403 order pertence a outro investidor', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'OUTRO',
      stellarClaimableBalanceId: BALANCE_ID,
    });
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(403);
  });

  it('409 sem stellarClaimableBalanceId (order não completou)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'inv_1',
      stellarClaimableBalanceId: null,
    });
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(409);
  });

  it('200 happy: retorna xdr + hashHex, XDR contém claimClaimableBalance', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'inv_1',
      stellarClaimableBalanceId: BALANCE_ID,
    });
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.xdr).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(json.hashHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(json.balanceId).toBe(BALANCE_ID);

    const tx = new Transaction(json.xdr, networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as { type: string; balanceId: string };
    expect(op.type).toBe('claimClaimableBalance');
    expect(op.balanceId).toBe(BALANCE_ID);
  });
});
