import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();

const { buildTrustlineXdr, fundAccountIfNeeded, resolveTesouroAsset } =
  vi.hoisted(() => ({
    buildTrustlineXdr: vi.fn(),
    fundAccountIfNeeded: vi.fn(),
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
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/stellar/transactions', () => ({ buildTrustlineXdr }));
vi.mock('@/lib/stellar/account', () => ({ fundAccountIfNeeded }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

import { POST } from '@/app/api/investidor/buy/trust-tesouro/build/route';

function req(body: object): Request {
  return new Request('http://x/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  buildTrustlineXdr
    .mockReset()
    .mockResolvedValue({ xdr: 'AAAA', hashHex: '0xhash' });
  fundAccountIfNeeded.mockReset().mockResolvedValue({ funded: false });
  resolveTesouroAsset
    .mockReset()
    .mockResolvedValue({ code: 'TESOURO', issuer: 'GTESOURO' });
});

describe('POST /api/investidor/buy/trust-tesouro/build', () => {
  it('400 pubkey inválida', async () => {
    const r = await POST(req({ pubkey: 'X' }));
    expect(r.status).toBe(400);
  });

  it('403 pubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ pubkey: OTHER_PK }));
    expect(r.status).toBe(403);
  });

  it('200 happy path', async () => {
    const r = await POST(req({ pubkey: USER_PK }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.tesouroCode).toBe('TESOURO');
  });
});
