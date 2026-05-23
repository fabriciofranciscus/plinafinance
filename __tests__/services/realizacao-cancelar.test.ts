import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  reservaFindUnique,
  reservaUpdate,
  cotaUpdate,
  eventoAuditCreate,
  registerOnChainHash,
} = vi.hoisted(() => ({
  reservaFindUnique: vi.fn(),
  reservaUpdate: vi.fn(),
  cotaUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  registerOnChainHash: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    reserva: { findUnique: reservaFindUnique },
    $transaction: async (
      cb: (tx: {
        reserva: { update: typeof reservaUpdate };
        cota: { update: typeof cotaUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        reserva: { update: reservaUpdate },
        cota: { update: cotaUpdate },
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

import { cancelarReserva } from '@/lib/services/realizacao';

const ACTIVE_RESERVA = {
  id: 'res_1',
  status: 'ATIVA',
  cotaId: 'cota_1',
  leadCompradorId: 'lead_1',
  cota: { status: 'RESERVADA' },
};

beforeEach(() => {
  reservaFindUnique.mockReset();
  reservaUpdate.mockReset().mockResolvedValue({});
  cotaUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  registerOnChainHash
    .mockReset()
    .mockResolvedValue({ payloadHash: 'hash_x', txHash: 'tx_x' });
});

describe('cancelarReserva — N-13', () => {
  it('throw quando reserva não existe', async () => {
    reservaFindUnique.mockResolvedValueOnce(null);
    await expect(cancelarReserva('res_x', 'admin')).rejects.toThrow(
      /não encontrada/,
    );
    expect(registerOnChainHash).not.toHaveBeenCalled();
  });

  it('throw quando reserva não está ATIVA', async () => {
    reservaFindUnique.mockResolvedValueOnce({
      ...ACTIVE_RESERVA,
      status: 'CANCELADA',
    });
    await expect(cancelarReserva('res_1', 'admin')).rejects.toThrow(
      /não cancelável/,
    );
    expect(registerOnChainHash).not.toHaveBeenCalled();
  });

  it('happy path: cancela + libera cota + grava audit + hash on-chain', async () => {
    reservaFindUnique.mockResolvedValueOnce(ACTIVE_RESERVA);
    const result = await cancelarReserva('res_1', 'admin-panel');
    expect(result).toEqual({ payloadHash: 'hash_x', txHash: 'tx_x' });
    expect(registerOnChainHash).toHaveBeenCalledOnce();
    expect(reservaUpdate).toHaveBeenCalledWith({
      where: { id: 'res_1' },
      data: { status: 'CANCELADA' },
    });
    expect(cotaUpdate).toHaveBeenCalledWith({
      where: { id: 'cota_1' },
      data: { status: 'DISPONIVEL' },
    });
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    const audit = eventoAuditCreate.mock.calls[0][0].data;
    expect(audit.acao).toBe('RESERVA_CANCELADA');
    expect(audit.operador).toBe('admin-panel');
    expect(audit.cotaId).toBe('cota_1');
    expect(audit.stellarTxHash).toBe('tx_x');
    expect(audit.payloadHash).toBe('hash_x');
  });

  it('cota não-RESERVADA: cancela só a reserva, não toca cota', async () => {
    reservaFindUnique.mockResolvedValueOnce({
      ...ACTIVE_RESERVA,
      cota: { status: 'DISPONIVEL' },
    });
    await cancelarReserva('res_1', 'admin');
    expect(reservaUpdate).toHaveBeenCalledOnce();
    expect(cotaUpdate).not.toHaveBeenCalled();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
  });
});
