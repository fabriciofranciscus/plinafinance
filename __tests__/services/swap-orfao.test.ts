import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());
const resgateFindFirst = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst }, resgateCotacao: { findFirst: resgateFindFirst } } }));

import { ApiError } from '@/lib/api/errors';
import { assertSemSwapEmConferencia } from '@/lib/services/swap-orfao';

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(null);
  resgateFindFirst.mockReset().mockResolvedValue(null);
});

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

describe('assertSemSwapEmConferencia — resgate com queima em conferência', () => {
  it('resgate reservado do mesmo investidor → 409 SWAP_EM_CONFERENCIA; o resgate informado é ignorado', async () => {
    resgateFindFirst.mockResolvedValue({ id: 'r_orfa' });
    await expect(assertSemSwapEmConferencia('inv_1')).rejects.toMatchObject({ code: 'SWAP_EM_CONFERENCIA' });
    await assertSemSwapEmConferencia('inv_1', { ignorarResgateId: 'r_atual' }).catch(() => undefined);
    expect(resgateFindFirst.mock.calls[1][0].where).toMatchObject({ investidorId: 'inv_1', id: { not: 'r_atual' }, consumedAt: null });
  });
});

