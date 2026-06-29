import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const {
  isLabEnabled,
  fundAccountIfNeeded,
  buildTrustlineXdr,
} = vi.hoisted(() => ({
  isLabEnabled: vi.fn(),
  fundAccountIfNeeded: vi.fn(),
  buildTrustlineXdr: vi.fn(),
}));

vi.mock('@/lib/env/lab', () => ({ isLabEnabled }));
vi.mock('@/lib/stellar/account', () => ({ fundAccountIfNeeded }));
vi.mock('@/lib/stellar/transactions', () => ({ buildTrustlineXdr }));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return {
    ...actual, // mantém AuthError real (withApi precisa dele)
    requireInvestidor: vi.fn().mockResolvedValue({
      privyId: 'did:privy:abc',
      investidorId: 'inv_1',
      publicKey: 'GABC',
      email: 'x@y.z',
      etherfuseCustomerId: 'cust_1',
    }),
  };
});

const SAVED_ISSUER = process.env.STELLAR_ISSUER_PUBLIC;
process.env.STELLAR_ISSUER_PUBLIC = 'GISSUER';

import { POST } from '@/app/api/lab/build-trustline/route';

beforeEach(() => {
  isLabEnabled.mockReset();
  fundAccountIfNeeded.mockReset().mockResolvedValue({ funded: false });
  buildTrustlineXdr.mockReset().mockResolvedValue({ xdr: 'XDR', hashHex: '0xH' });
  // Força o issuer de teste (SAVED_ISSUER guarda o valor real só pra restaurar).
  process.env.STELLAR_ISSUER_PUBLIC = 'GISSUER';
});

afterAll(() => {
  if (SAVED_ISSUER === undefined) delete process.env.STELLAR_ISSUER_PUBLIC;
  else process.env.STELLAR_ISSUER_PUBLIC = SAVED_ISSUER;
});

function req(): Request {
  return new Request('http://x/build-trustline', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

describe('POST /api/lab/build-trustline — C-07', () => {
  it('LAB_ENABLED=false → 404 (não vaza existência)', async () => {
    isLabEnabled.mockReturnValue(false);
    const r = await POST(req());
    expect(r.status).toBe(404);
    expect(buildTrustlineXdr).not.toHaveBeenCalled();
    expect(fundAccountIfNeeded).not.toHaveBeenCalled();
  });

  it('LAB_ENABLED=true → 200 com pubkey do JWT', async () => {
    isLabEnabled.mockReturnValue(true);
    const r = await POST(req());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.xdr).toBe('XDR');
    // pubkey usada vem do user.publicKey, não de body.
    expect(buildTrustlineXdr).toHaveBeenCalledWith('GABC', 'GISSUER');
  });
});
