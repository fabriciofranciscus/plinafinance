/**
 * onramp/status — TRAVA POR ORDEM no banco (no máximo 1 consulta à Etherfuse por ordem a cada N s, entre instâncias) e CONCLUSÃO
 * endurecida (escrita condicional: 1 transição e 1 evento de auditoria). Banco e reserva simulados aqui; a reserva em si, com
 * concorrência real, está em `__tests__/services/onramp-status-reserva-pg.test.ts` e `onramp-status-rota-pg.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@/lib/services/onramp-status-reserva', async (orig) => ({ ...(await orig<typeof import('@/lib/services/onramp-status-reserva')>()), reservarConsultaDeStatus: reservar }));
vi.mock('@/lib/rate-limit/config', () => ({ onrampStatusLimiter: { consume, reset: vi.fn() } }));

process.env.ETHERFUSE_API_KEY = 'test';

import { GET } from '@/app/api/investidor/buy/onramp/status/route';

const ordem = (id: string, over: Record<string, unknown> = {}) => ({
  id, investidorId: 'inv_1', status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null, claimTxHash: null,
  paymentInstructionsJson: { __mock: false, pix: 'x' }, settledAt: null, ...over,
});
const req = (id: string) => new Request(`http://x/status?orderId=${id}`, { method: 'GET' });
let n = 0;
const novoId = () => `ord_trava_${++n}`; // o cache de 5 s é por ordem: um id novo por teste

beforeEach(() => {
  for (const f of [findUnique, updateMany, auditCreate, reservar, getOnRampTransaction, consume]) f.mockReset();
  consume.mockResolvedValue(true);
  reservar.mockResolvedValue(true);
  updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('onramp/status — trava por ordem no banco', () => {
  it('ganhou a reserva: consulta a Etherfuse (1 vez) e responde com o remoto', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'processing', stellarTxHash: null });
    const r = await GET(req(id));
    expect(r.status).toBe(200);
    expect(reservar).toHaveBeenCalledWith(id);
    expect(getOnRampTransaction).toHaveBeenCalledTimes(1);
  });

  it('perdeu a reserva (outra instância consultou há menos de N s): 200 com o estado do banco, SEM consultar a Etherfuse e no mesmo formato', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { status: 'processing' }));
    getOnRampTransaction.mockResolvedValue({ status: 'processing', stellarTxHash: null });
    const normal = await (await GET(req(id))).json();
    const outra = novoId();
    findUnique.mockResolvedValue(ordem(outra, { status: 'processing' }));
    getOnRampTransaction.mockClear();
    reservar.mockResolvedValue(false);
    const r = await GET(req(outra));
    expect(r.status).toBe(200);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
    const lim = await r.json();
    expect(Object.keys(lim.data).sort()).toEqual(Object.keys(normal.data).sort());
    expect(lim.data.status).toBe('processing');
    expect(updateMany).not.toHaveBeenCalled(); // a degradada nunca escreve no banco (e a 1ª, sem mudança de estado, também não)
  });

  it('erro ao reservar (banco fora, coluna ainda inexistente): degrada para o banco, nunca 500 nem 429, sem consultar a Etherfuse; só o nome do erro vai ao log', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    reservar.mockRejectedValue(Object.assign(new Error('column "statusConsultadoEm" does not exist'), { name: 'PrismaClientKnownRequestError' }));
    const r = await GET(req(id));
    expect(r.status).toBe(200);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
    const logado = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logado).toContain('PrismaClientKnownRequestError');
    expect(logado).not.toContain('statusConsultadoEm');
  });

  it('cache de 5 s acertou: nem toca o banco (a reserva não é chamada) nem a Etherfuse', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'processing', stellarTxHash: null });
    await GET(req(id));
    await GET(req(id));
    expect(reservar).toHaveBeenCalledTimes(1);
    expect(getOnRampTransaction).toHaveBeenCalledTimes(1);
  });

  it('dono vem antes: ordem de outro investidor é 403 e a reserva não é gasta', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { investidorId: 'inv_OUTRO' }));
    const r = await GET(req(id));
    expect(r.status).toBe(403);
    expect(reservar).not.toHaveBeenCalled();
  });

  it('ordem terminal ou mock nunca reserva nem consulta a Etherfuse', async () => {
    const a = novoId(); const b = novoId();
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === a ? ordem(a, { status: 'completed' }) : ordem(b, { paymentInstructionsJson: { __mock: true } }));
    await GET(req(a)); await GET(req(b));
    expect(reservar).not.toHaveBeenCalled();
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });

  it('limiter por investidor estourado: degrada ANTES da reserva (a reserva não é gasta)', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    consume.mockResolvedValue(false);
    const r = await GET(req(id));
    expect(r.status).toBe(200);
    expect(reservar).not.toHaveBeenCalled();
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });

  it('falha do anchor depois de ganhar: a reserva NÃO é desfeita e a rota não tenta de novo na mesma requisição', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockRejectedValue(new Error('anchor fora do ar'));
    const r = await GET(req(id));
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(reservar).toHaveBeenCalledTimes(1);
    expect(getOnRampTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('onramp/status — conclusão endurecida (1 transição, 1 evento de auditoria)', () => {
  it('completed pela 1ª vez: escrita condicional (só ordem não terminal e não liquidada) e 1 evento', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'completed', stellarTxHash: 'tx1' });
    await GET(req(id));
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toMatchObject({ id, settledAt: null, status: { notIn: expect.arrayContaining(['completed', 'failed', 'expired', 'cancelled', 'refunded']) } });
    expect(arg.data).toMatchObject({ status: 'completed', stellarTxHash: 'tx1', settledAt: expect.any(Date) });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('outra consulta já liquidou a ordem (updateMany count 0): NENHUM evento duplicado', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'completed', stellarTxHash: 'tx1' });
    updateMany.mockResolvedValue({ count: 0 });
    await GET(req(id));
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('mudança que não é conclusão (pending → processing): grava, sem settledAt e sem evento', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { status: 'pending' }));
    getOnRampTransaction.mockResolvedValue({ status: 'processing', stellarTxHash: null });
    await GET(req(id));
    const arg = updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('settledAt');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('sem mudança: nenhuma escrita', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { status: 'processing' }));
    getOnRampTransaction.mockResolvedValue({ status: 'processing', stellarTxHash: null });
    await GET(req(id));
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
