import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  upsert,
  update,
  getUserById,
  createWallet,
  txRunner,
} = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  getUserById: vi.fn(),
  createWallet: vi.fn(),
  txRunner: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $transaction: txRunner },
}));

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class {
    getUserById = getUserById;
    walletApi = { createWallet };
  },
}));

import { ensureStellarWallet } from '@/lib/wallet/privy';

beforeEach(() => {
  process.env.PRIVY_APP_ID = 'app';
  process.env.PRIVY_APP_SECRET = 'sec';
  upsert.mockReset();
  update.mockReset().mockResolvedValue({});
  getUserById.mockReset().mockResolvedValue({ linkedAccounts: [] });
  createWallet.mockReset();
  txRunner.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      walletProvisioning: { upsert, update },
    }),
  );
});

describe('ensureStellarWallet — F-16', () => {
  it('lock pré-existente com publicKey retorna direto (sem createWallet)', async () => {
    upsert.mockResolvedValueOnce({
      privyId: 'u1',
      publicKey: 'GCACHED',
    });
    const r = await ensureStellarWallet('u1');
    expect(r).toBe('GCACHED');
    expect(createWallet).not.toHaveBeenCalled();
  });

  it('wallet já existe no Privy → preenche lock sem criar', async () => {
    upsert.mockResolvedValueOnce({ privyId: 'u2', publicKey: null });
    getUserById.mockResolvedValueOnce({
      linkedAccounts: [
        {
          type: 'wallet',
          chainType: 'stellar',
          address: 'GEXISTING' + 'A'.repeat(47),
        },
      ],
    });
    const r = await ensureStellarWallet('u2');
    expect(createWallet).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { privyId: 'u2' },
      data: { publicKey: r },
    });
  });

  it('cria wallet quando não existe e persiste no lock', async () => {
    upsert.mockResolvedValueOnce({ privyId: 'u3', publicKey: null });
    getUserById.mockResolvedValueOnce({ linkedAccounts: [] });
    createWallet.mockResolvedValueOnce({ address: 'GNEW' });
    const r = await ensureStellarWallet('u3');
    expect(r).toBe('GNEW');
    expect(createWallet).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { privyId: 'u3' },
      data: { publicKey: 'GNEW' },
    });
  });

  it('usa isolationLevel Serializable', async () => {
    upsert.mockResolvedValueOnce({ privyId: 'u4', publicKey: 'GX' });
    await ensureStellarWallet('u4');
    expect(txRunner).toHaveBeenCalledOnce();
    const opts = txRunner.mock.calls[0][1];
    expect(opts).toMatchObject({ isolationLevel: 'Serializable' });
  });
});
