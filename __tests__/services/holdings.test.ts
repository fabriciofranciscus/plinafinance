import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { decrementarHolding } from '@/lib/services/holdings';

// logStellarError não pode derrubar o teste; só queremos confirmar que é
// chamado nos caminhos de drift (no-op / underflow).
vi.mock('@/lib/stellar/log-error', () => ({
  logStellarError: vi.fn(),
}));
import { logStellarError } from '@/lib/stellar/log-error';

/** Fake mínimo do Prisma.TransactionClient pro holdingPLINARF. */
function fakeTx(saldoAtual: string | null) {
  const update = vi.fn().mockResolvedValue(undefined);
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      saldoAtual === null ? null : { saldo: new Prisma.Decimal(saldoAtual) },
    );
  const tx = { holdingPLINARF: { findUnique, update } };
  return { tx: tx as unknown as Prisma.TransactionClient, update, findUnique };
}

const BASE = { investidorId: 'inv_1', classe: 'SENIOR' as const, txHash: 'tx_1' };

beforeEach(() => {
  vi.mocked(logStellarError).mockReset();
});

describe('decrementarHolding', () => {
  it('decremento normal: 100 - 30 = 70', async () => {
    const { tx, update } = fakeTx('100');
    await decrementarHolding(tx, { ...BASE, amount: '30' });
    expect(update).toHaveBeenCalledOnce();
    const saldo = update.mock.calls[0][0].data.saldo as Prisma.Decimal;
    expect(saldo.toString()).toBe('70');
    expect(logStellarError).not.toHaveBeenCalled();
  });

  it('liquidação total: 100 - 100 = 0 (sem warn de underflow)', async () => {
    const { tx, update } = fakeTx('100');
    await decrementarHolding(tx, { ...BASE, amount: '100' });
    const saldo = update.mock.calls[0][0].data.saldo as Prisma.Decimal;
    expect(saldo.toString()).toBe('0');
    expect(logStellarError).not.toHaveBeenCalled();
  });

  it('clamp-to-zero quando amount > saldo + loga underflow (não lança)', async () => {
    const { tx, update } = fakeTx('40');
    await expect(
      decrementarHolding(tx, { ...BASE, amount: '100' }),
    ).resolves.toBeUndefined();
    const saldo = update.mock.calls[0][0].data.saldo as Prisma.Decimal;
    expect(saldo.toString()).toBe('0');
    expect(logStellarError).toHaveBeenCalledOnce();
  });

  it('row inexistente: no-op (não chama update) + loga drift, não lança', async () => {
    const { tx, update } = fakeTx(null);
    await expect(
      decrementarHolding(tx, { ...BASE, amount: '10' }),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(logStellarError).toHaveBeenCalledOnce();
  });

  it('preserva precisão de 7 casas (Decimal, não float)', async () => {
    const { tx, update } = fakeTx('0.0000003');
    await decrementarHolding(tx, { ...BASE, amount: '0.0000001' });
    const saldo = update.mock.calls[0][0].data.saldo as Prisma.Decimal;
    expect(saldo.equals(new Prisma.Decimal('0.0000002'))).toBe(true);
  });
});
