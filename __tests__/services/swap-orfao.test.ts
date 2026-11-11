import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst } } }));

import { ApiError } from '@/lib/api/errors';
import { assertSemSwapEmConferencia } from '@/lib/services/swap-orfao';

beforeEach(() => findFirst.mockReset().mockResolvedValue(null));

describe('assertSemSwapEmConferencia', () => {
  it('sem reserva órfã do investidor → passa', async () => {
    await expect(assertSemSwapEmConferencia('inv_1')).resolves.toBeUndefined();
  });

  it('com reserva órfã → 409 SWAP_EM_CONFERENCIA', async () => {
    findFirst.mockResolvedValue({ id: 'q_orfa' });
    const err = await assertSemSwapEmConferencia('inv_1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('SWAP_EM_CONFERENCIA');
    expect(err.status).toBe(409);
  });

  it('só olha swaps do MESMO investidor, reservados e não consumidos; ignora o quote informado', async () => {
    await assertSemSwapEmConferencia('inv_1', { ignorarQuoteId: 'q_1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        investidorId: 'inv_1',
        submitXdrHash: { not: null },
        consumedAt: null,
        plinarfAmount: { not: null },
        id: { not: 'q_1' },
      },
      select: { id: true },
    });
  });
});
