/**
 * onramp/status — limite POR INVESTIDOR (40/min) + cache curto (5 s) do status remoto. Acima do limite (ou com o limiter fora do ar)
 * a rota NÃO devolve 429 nem consulta a Etherfuse: responde com o estado guardado no banco, no mesmo formato.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findUnique, update, updateMany, reservar, getOnRampTransaction, consume } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  reservar: vi.fn(),
  getOnRampTransaction: vi.fn(),
  consume: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return {
    ...actual,
    requireInvestidor: vi.fn().mockResolvedValue({ privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GABC', email: 'x@y.z', etherfuseCustomerId: 'cust_1' }),
  };
});
vi.mock('@/lib/db', () => ({
  db: {
    onRampOrder: { findUnique, update, updateMany },
    eventoAudit: { create: vi.fn() },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ onRampOrder: { update, updateMany }, eventoAudit: { create: vi.fn() } }),
  },
}));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class { getOnRampTransaction = getOnRampTransaction; } }));
// A reserva por ordem no banco tem teste próprio (onramp-status-reserva-pg e status-trava): aqui ela sempre ganha.
vi.mock('@/lib/services/onramp-status-reserva', async (orig) => ({ ...(await orig<typeof import('@/lib/services/onramp-status-reserva')>()), reservarConsultaDeStatus: reservar }));
vi.mock('@/lib/rate-limit/config', () => ({ onrampStatusLimiter: { consume, reset: vi.fn() } }));

process.env.ETHERFUSE_API_KEY = 'test';

import { GET } from '@/app/api/investidor/buy/onramp/status/route';

const ordem = (id: string, over: Record<string, unknown> = {}) => ({
  id, investidorId: 'inv_1', status: 'pending', stellarTxHash: null, stellarClaimableBalanceId: null, claimTxHash: null,
  paymentInstructionsJson: { __mock: false, pix: 'x' }, settledAt: null, ...over,
});
const req = (id: string) => new Request(`http://x/status?orderId=${id}`, { method: 'GET' });
let n = 0;
const novoId = () => `ord_lim_${++n}`; // o cache é por ordem: um id novo por teste

beforeEach(() => {
  findUnique.mockReset(); update.mockReset(); updateMany.mockReset(); reservar.mockReset(); getOnRampTransaction.mockReset(); consume.mockReset();
  consume.mockResolvedValue(true);
  reservar.mockResolvedValue(true);
  updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { vi.useRealTimers(); });

describe('onramp/status — limite por investidor', () => {
  it('a chave do limite é o investidorId da sessão (nunca IP nem orderId)', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    await GET(req(id));
    expect(consume).toHaveBeenCalledWith('inv_1');
  });

  it('acima do limite: 200 com o estado do banco, SEM consultar a Etherfuse, mesmo formato da resposta normal', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { status: 'pending' }));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    const normal = await (await GET(req(id))).json();
    getOnRampTransaction.mockClear();
    consume.mockResolvedValue(false);
    const r = await GET(req(id));
    expect(r.status).toBe(200);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
    const lim = await r.json();
    expect(Object.keys(lim.data).sort()).toEqual(Object.keys(normal.data).sort());
    expect(lim.data.status).toBe('pending');
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('41 chamadas no minuto com limiter real (40/min): a 41ª não consulta a Etherfuse e responde 200', async () => {
    const { createRateLimiter } = await import('@/lib/rate-limit/in-memory');
    const real = createRateLimiter({ limit: 40, windowMs: 60_000 });
    consume.mockImplementation((k: string) => real.consume(k));
    const ids = Array.from({ length: 41 }, () => novoId()); // ordens distintas: o cache não mascara o limite
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ordem(where.id));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    let ultima: Response | undefined;
    for (const id of ids) ultima = await GET(req(id));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(40);
    expect(ultima!.status).toBe(200);
  });

  it('limiter fora do ar (lança): degrada para o banco, sem consultar a Etherfuse (falha fechada para o anchor)', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    consume.mockRejectedValue(new Error('upstash down'));
    const r = await GET(req(id));
    expect(r.status).toBe(200);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });

  it('a checagem de dono vem ANTES do limite: ordem de outro investidor é 403 e não gasta o limite (sem oráculo)', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id, { investidorId: 'inv_OUTRO' }));
    consume.mockResolvedValue(false);
    const r = await GET(req(id));
    expect(r.status).toBe(403);
    expect(consume).not.toHaveBeenCalled();
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });

  it('ordem terminal ou mock não consome o limite nem consulta a Etherfuse', async () => {
    const t = novoId(); const m = novoId();
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === t ? ordem(t, { status: 'completed' }) : ordem(m, { paymentInstructionsJson: { __mock: true } }));
    expect((await GET(req(t))).status).toBe(200);
    expect((await GET(req(m))).status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });
});

describe('onramp/status — cache curto do status remoto (5 s, por ordem)', () => {
  it('duas leituras em menos de 5 s: uma consulta à Etherfuse; depois de 5 s, outra', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    await GET(req(id));
    vi.setSystemTime(new Date('2026-11-16T12:00:03Z'));
    await GET(req(id));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-16T12:00:06Z'));
    await GET(req(id));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(2);
  });

  it('o cache é por ordem: outra ordem consulta a sua', async () => {
    const a = novoId(); const b = novoId();
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ordem(where.id));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    await GET(req(a)); await GET(req(b));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(2);
  });

  it('estado terminal NÃO é cacheado: a leitura seguinte vê o banco/anchor atual', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'completed', stellarTxHash: 'tx1' });
    const r1 = await (await GET(req(id))).json();
    expect(r1.data.status).toBe('completed');
    expect(updateMany).toHaveBeenCalledTimes(1); // o banco foi atualizado normalmente (escrita condicional)
    getOnRampTransaction.mockResolvedValue({ status: 'completed', stellarTxHash: 'tx1' });
    await GET(req(id));
    expect(getOnRampTransaction).toHaveBeenCalledTimes(2);
  });

  it('o cache serve só para quem já passou no dono e no limite (ordem alheia continua 403 mesmo com cache quente)', async () => {
    const id = novoId();
    findUnique.mockResolvedValue(ordem(id));
    getOnRampTransaction.mockResolvedValue({ status: 'pending', stellarTxHash: null });
    await GET(req(id));
    findUnique.mockResolvedValue(ordem(id, { investidorId: 'inv_OUTRO' }));
    expect((await GET(req(id))).status).toBe(403);
  });
});
