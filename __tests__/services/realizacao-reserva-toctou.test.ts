import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  cotaFindUnique,
  leadFindUnique,
  reservaCreate,
  cotaUpdateMany,
  leadUpdate,
  eventoAuditCreate,
  registerOnChainHash,
} = vi.hoisted(() => ({
  cotaFindUnique: vi.fn(),
  leadFindUnique: vi.fn(),
  reservaCreate: vi.fn(),
  cotaUpdateMany: vi.fn(),
  leadUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  registerOnChainHash: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    cota: { findUnique: cotaFindUnique },
    leadComprador: { findUnique: leadFindUnique },
    $transaction: async (
      cb: (tx: {
        reserva: { create: typeof reservaCreate };
        cota: { updateMany: typeof cotaUpdateMany };
        leadComprador: { update: typeof leadUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        reserva: { create: reservaCreate },
        cota: { updateMany: cotaUpdateMany },
        leadComprador: { update: leadUpdate },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/stellar/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/audit')>(
    '@/lib/stellar/audit',
  );
  return { ...actual, registerOnChainHash };
});

import { criarReserva } from '@/lib/services/realizacao';

const COTA = {
  id: 'cota_1',
  status: 'DISPONIVEL',
  valorCarta: '100000.00',
  desagioRevenda: '0.10',
};
const LEAD = { id: 'lead_1', status: 'QUALIFICADO' };

beforeEach(() => {
  cotaFindUnique.mockReset().mockResolvedValue(COTA);
  leadFindUnique.mockReset().mockResolvedValue(LEAD);
  reservaCreate.mockReset().mockResolvedValue({ id: 'res_1' });
  cotaUpdateMany.mockReset();
  leadUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  registerOnChainHash
    .mockReset()
    .mockResolvedValue({ payloadHash: 'hash_x', txHash: 'tx_x' });
});

describe('criarReserva — TOCTOU (#7)', () => {
  it('claim atômico: flip condicional DISPONIVEL→RESERVADA', async () => {
    cotaUpdateMany.mockResolvedValue({ count: 1 });
    const result = await criarReserva({
      cotaId: 'cota_1',
      leadCompradorId: 'lead_1',
    });
    expect(result.reservaId).toBe('res_1');
    expect(cotaUpdateMany).toHaveBeenCalledWith({
      where: { id: 'cota_1', status: 'DISPONIVEL' },
      data: { status: 'RESERVADA' },
    });
    expect(reservaCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
  });

  it('perdedor da corrida: count=0 → throw e rollback (sem audit)', async () => {
    // Cota já reservada concorrentemente entre o findUnique (:290) e o claim.
    cotaUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      criarReserva({ cotaId: 'cota_1', leadCompradorId: 'lead_1' }),
    ).rejects.toThrow(/não está mais disponível/);
    // A reserva foi criada na mesma tx, mas o throw subsequente faz rollback —
    // o que importa é que o lead/audit do perdedor não seguem adiante.
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(eventoAuditCreate).not.toHaveBeenCalled();
  });

  it('fast-fail antes da tx: cota não DISPONIVEL nem chama on-chain', async () => {
    cotaFindUnique.mockResolvedValueOnce({ ...COTA, status: 'RESERVADA' });
    await expect(
      criarReserva({ cotaId: 'cota_1', leadCompradorId: 'lead_1' }),
    ).rejects.toThrow(/não reservável/);
    expect(registerOnChainHash).not.toHaveBeenCalled();
    expect(cotaUpdateMany).not.toHaveBeenCalled();
  });
});
