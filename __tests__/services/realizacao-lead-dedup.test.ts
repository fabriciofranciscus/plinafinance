import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirst, upsert, eventoAuditCreate, txRunner, registerOnChainHash } =
  vi.hoisted(() => ({
    findFirst: vi.fn(),
    upsert: vi.fn(),
    eventoAuditCreate: vi.fn(),
    txRunner: vi.fn(),
    registerOnChainHash: vi.fn(),
  }));

vi.mock('@/lib/db', () => ({
  db: {
    eventoAudit: { findFirst },
    $transaction: txRunner,
  },
}));

vi.mock('@/lib/stellar/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/audit')>(
    '@/lib/stellar/audit',
  );
  return { ...actual, registerOnChainHash };
});

import { capturarLeadComprador } from '@/lib/services/realizacao';

const BASE = {
  nome: 'Maria',
  email: 'Maria@Example.com',
  tipo: 'PESSOA_FISICA' as const,
  consentimentoLgpd: true,
};

beforeEach(() => {
  findFirst.mockReset();
  upsert.mockReset().mockResolvedValue({ id: 'lead_1' });
  eventoAuditCreate.mockReset().mockResolvedValue({});
  registerOnChainHash.mockReset().mockResolvedValue({
    txHash: 'tx_NEW',
    payloadHash: 'hash_NEW',
  });
  txRunner.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      leadComprador: { upsert },
      eventoAudit: { create: eventoAuditCreate },
    }),
  );
});

describe('capturarLeadComprador — F-21 dedup', () => {
  it('primeiro lead grava on-chain (Stellar tx)', async () => {
    findFirst.mockResolvedValueOnce(null);
    const r = await capturarLeadComprador(BASE);
    expect(registerOnChainHash).toHaveBeenCalledOnce();
    expect(r.txHash).toBe('tx_NEW');
  });

  it('reenvio dentro da janela reusa txHash existente', async () => {
    findFirst.mockResolvedValueOnce({
      stellarTxHash: 'tx_OLD',
      payloadHash: 'hash_OLD',
      payloadJson: {},
    });
    const r = await capturarLeadComprador(BASE);
    expect(registerOnChainHash).not.toHaveBeenCalled();
    expect(r.txHash).toBe('tx_OLD');
    expect(r.payloadHash).toBe('hash_OLD');
  });

  it('normaliza email pra lowercase no lookup', async () => {
    findFirst.mockResolvedValueOnce(null);
    await capturarLeadComprador(BASE);
    const where = findFirst.mock.calls[0][0].where;
    expect(where.leadComprador.email).toBe('maria@example.com');
  });

  it('audit sem stellarTxHash não conta como dedup hit', async () => {
    // O where da query já filtra stellarTxHash != null, mas se vier null
    // mesmo assim (defensivo), registra novo.
    findFirst.mockResolvedValueOnce({
      stellarTxHash: null,
      payloadHash: 'h',
      payloadJson: {},
    });
    const r = await capturarLeadComprador(BASE);
    expect(registerOnChainHash).toHaveBeenCalledOnce();
    expect(r.txHash).toBe('tx_NEW');
  });
});
