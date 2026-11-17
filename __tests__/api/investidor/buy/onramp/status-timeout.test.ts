/** onramp/status: timeout da Etherfuse (ANCHOR_TIMEOUT) degrada para o estado do banco: 200, mesmo formato, sem 500 nem gravação. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchorError } from '@/lib/anchors/types';

const { findUnique, updateMany, auditCreate, reservar, getOnRampTransaction, consume } = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn(), auditCreate: vi.fn(), reservar: vi.fn(), getOnRampTransaction: vi.fn(), consume: vi.fn(),
}));
vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return { ...actual, requireInvestidor: vi.fn().mockResolvedValue({ privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GABC', email: 'x@y.z', etherfuseCustomerId: 'cust_1' }) };
});
vi.mock('@/lib/db', () => ({
  db: {
    onRampOrder: { findUnique, updateMany },
    eventoAudit: { create: auditCreate },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ onRampOrder: { updateMany }, eventoAudit: { create: auditCreate } }),
  },
}));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class { getOnRampTransaction = getOnRampTransaction; } }));
vi.mock('@/lib/services/onramp-status-reserva', () => ({ reservarConsultaDeStatus: reservar }));
vi.mock('@/lib/rate-limit/config', () => ({ onrampStatusLimiter: { consume, reset: vi.fn() } }));
process.env.ETHERFUSE_API_KEY = 'test';

import { GET } from '@/app/api/investidor/buy/onramp/status/route';

const ordem = (id: string) => ({
  id, investidorId: 'inv_1', status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null, claimTxHash: null,
  paymentInstructionsJson: { __mock: false, pix: 'x' }, settledAt: null,
});
const req = (id: string) => new Request(`http://x/status?orderId=${id}`, { method: 'GET' });
let n = 0;

beforeEach(() => {
  for (const f of [findUnique, updateMany, auditCreate, reservar, getOnRampTransaction, consume]) f.mockReset();
  consume.mockResolvedValue(true); reservar.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('onramp/status — timeout do anchor', () => {
  it('ANCHOR_TIMEOUT: 200 com o estado do banco (mesmas chaves), sem gravar e sem 5xx', async () => {
    const id = `ord_to_${++n}`;
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null });
    const normal = await (await GET(req(id))).json(); // chave de comparação: uma resposta normal
    const id2 = `ord_to_${++n}`;
    findUnique.mockResolvedValue(ordem(id2));
    getOnRampTransaction.mockRejectedValueOnce(new AnchorError('Etherfuse não respondeu a tempo', 'ANCHOR_TIMEOUT', 504));
    const r = await GET(req(id2));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Object.keys(j.data).sort()).toEqual(Object.keys(normal.data).sort());
    expect(j.data.status).toBe('processing');
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
  it('o timeout não entra no cache: a leitura seguinte consulta de novo', async () => {
    const id = `ord_to_${++n}`;
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockRejectedValueOnce(new AnchorError('t', 'ANCHOR_TIMEOUT', 504));
    await GET(req(id));
    getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null });
    await GET(req(id));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(2);
  });
  it('outro erro do anchor (não timeout) NÃO é engolido: continua o tratamento de antes (não é 200)', async () => {
    const id = `ord_to_${++n}`;
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockRejectedValueOnce(new AnchorError('x', 'UNKNOWN_ERROR', 500));
    const r = await GET(req(id));
    expect(r.status).not.toBe(200);
  });
});
