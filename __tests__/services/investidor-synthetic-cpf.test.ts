import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { investidor: { findUnique } },
}));

// STELLAR_NETWORK é capturado em load-time do módulo config; mock o
// módulo inteiro pra forçar PUBLIC neste teste.
vi.mock('@/lib/stellar/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/config')>(
    '@/lib/stellar/config',
  );
  return { ...actual, STELLAR_NETWORK: 'PUBLIC' as const };
});

import { assertElegivelParaTrustline } from '@/lib/services/investidor';

beforeEach(() => {
  findUnique.mockReset();
});

const BASE = {
  id: 'inv_1',
  status: 'AUTORIZADO',
  kycAprovado: true,
  publicKey: 'GABC',
  isSyntheticCpf: false,
};

describe('assertElegivelParaTrustline — N-14 (STELLAR_NETWORK=PUBLIC)', () => {
  it('throw quando investidor tem isSyntheticCpf=true em mainnet', async () => {
    findUnique.mockResolvedValueOnce({ ...BASE, isSyntheticCpf: true });
    await expect(
      assertElegivelParaTrustline({ investidorId: 'inv_1' }),
    ).rejects.toThrow(/sintético/i);
  });

  it('passa quando isSyntheticCpf=false em mainnet', async () => {
    findUnique.mockResolvedValueOnce({ ...BASE, isSyntheticCpf: false });
    await expect(
      assertElegivelParaTrustline({ investidorId: 'inv_1' }),
    ).resolves.toBeUndefined();
  });
});

