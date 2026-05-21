import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  reservaFindUnique,
  realizacaoCreate,
  cotaUpdate,
  reservaUpdate,
  leadUpdate,
  eventoAuditCreate,
  txRunner,
  registerOnChainHash,
} = vi.hoisted(() => ({
  reservaFindUnique: vi.fn(),
  realizacaoCreate: vi.fn(),
  cotaUpdate: vi.fn(),
  reservaUpdate: vi.fn(),
  leadUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  txRunner: vi.fn(),
  registerOnChainHash: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    reserva: { findUnique: reservaFindUnique },
    $transaction: txRunner,
  },
}));

vi.mock('@/lib/stellar/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/audit')>(
    '@/lib/stellar/audit',
  );
  return { ...actual, registerOnChainHash };
});

import { executarCaminhoA } from '@/lib/services/realizacao';

beforeEach(() => {
  registerOnChainHash.mockReset().mockResolvedValue({
    txHash: 'tx',
    payloadHash: 'hash',
  });
  realizacaoCreate.mockReset().mockResolvedValue({ id: 'real_1' });
  cotaUpdate.mockReset().mockResolvedValue({});
  reservaUpdate.mockReset().mockResolvedValue({});
  leadUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  txRunner.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      realizacaoCaminho: { create: realizacaoCreate },
      cota: { update: cotaUpdate },
      reserva: { update: reservaUpdate },
      leadComprador: { update: leadUpdate },
      eventoAudit: { create: eventoAuditCreate },
    }),
  );
});

describe('executarCaminhoA — F-25 precisão Decimal', () => {
  it('preserva centavos no custoAquisicao e spread', async () => {
    // valorCarta=123.45, desagio=0.0567 → custo = 123.45 * 0.9433 = 116.450985
    // Arredondado HALF_EVEN a 2 casas = 116.45.
    // spread = 130.00 - 116.45 = 13.55 (não 13 nem 14 como faria Math.floor).
    reservaFindUnique.mockResolvedValueOnce({
      id: 'r_1',
      cotaId: 'c_1',
      leadCompradorId: 'l_1',
      status: 'ATIVA',
      cota: {
        id: 'c_1',
        status: 'RESERVADA',
        valorCarta: new Prisma.Decimal('123.45'),
        desagioAquisicao: new Prisma.Decimal('0.0567'),
      },
      leadComprador: { id: 'l_1' },
    });

    const r = await executarCaminhoA({
      reservaId: 'r_1',
      valorRealizado: '130.00',
      operador: 'op',
    });

    expect(r.spread).toBe('13.55');
    const created = realizacaoCreate.mock.calls[0][0].data;
    expect(created.valorRealizado).toBe('130.00');
    expect(created.custoAquisicao).toBe('116.45');
    expect(created.spread).toBe('13.55');
  });

  it('rejeita valorRealizado inválido', async () => {
    reservaFindUnique.mockResolvedValueOnce({
      id: 'r_1',
      cotaId: 'c_1',
      leadCompradorId: 'l_1',
      status: 'ATIVA',
      cota: {
        status: 'RESERVADA',
        valorCarta: new Prisma.Decimal('100'),
        desagioAquisicao: new Prisma.Decimal('0.1'),
      },
      leadComprador: {},
    });
    await expect(
      executarCaminhoA({
        reservaId: 'r_1',
        valorRealizado: 'abc',
        operador: 'op',
      }),
    ).rejects.toThrow(/valorRealizado/);
  });
});
