import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { investidor: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/wallet/privy', () => ({
  getPrivyClient: vi.fn(),
}));

import { db } from '@/lib/db';
import { getPrivyClient } from '@/lib/wallet/privy';
import { requireInvestidor } from '@/lib/wallet/auth-guard';

const verifyAuthToken = vi.fn();
(getPrivyClient as ReturnType<typeof vi.fn>).mockReturnValue({
  verifyAuthToken,
});

function reqWith(authHeader?: string): Request {
  return new Request('http://x/y', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  verifyAuthToken.mockReset();
  (db.investidor.findUnique as ReturnType<typeof vi.fn>).mockReset();
});

describe('requireInvestidor', () => {
  it('401 sem header', async () => {
    await expect(requireInvestidor(reqWith())).rejects.toMatchObject({
      status: 401,
      message: /ausente/,
    });
  });

  it('401 com token inválido', async () => {
    verifyAuthToken.mockRejectedValueOnce(new Error('bad'));
    await expect(
      requireInvestidor(reqWith('Bearer xxx')),
    ).rejects.toMatchObject({ status: 401, message: /inválido/ });
  });

  it('403 quando privy ok mas sem Investidor', async () => {
    verifyAuthToken.mockResolvedValueOnce({ userId: 'did:privy:abc' });
    (
      db.investidor.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);
    await expect(
      requireInvestidor(reqWith('Bearer good')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('devolve AuthedInvestidor com sucesso', async () => {
    verifyAuthToken.mockResolvedValueOnce({ userId: 'did:privy:abc' });
    (
      db.investidor.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'inv_1',
      publicKey: 'GABC',
      email: 'x@y.z',
      etherfuseCustomerId: 'cust_1',
    });
    const u = await requireInvestidor(reqWith('Bearer good'));
    expect(u).toEqual({
      privyId: 'did:privy:abc',
      investidorId: 'inv_1',
      publicKey: 'GABC',
      email: 'x@y.z',
      etherfuseCustomerId: 'cust_1',
    });
  });
});
