import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, getOnRampTransaction, update, auditCreate } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getOnRampTransaction: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return {
    ...actual, // mantém AuthError real (withApi precisa dele)
    requireInvestidor: vi.fn().mockResolvedValue({
      privyId: 'did:privy:abc',
      investidorId: 'inv_1',
      publicKey: 'GABC',
      email: 'x@y.z',
      etherfuseCustomerId: 'cust_1',
    }),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    onRampOrder: { findUnique },
    // Quando o status muda a rota grava numa transação (mesmo contrato de antes; só os mocks para o caso de mudança).
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ onRampOrder: { update }, eventoAudit: { create: auditCreate } }),
  },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    getOnRampTransaction = getOnRampTransaction;
  },
}));

process.env.ETHERFUSE_API_KEY = 'test';

import { GET } from '@/app/api/investidor/buy/onramp/status/route';

function req(qs: string): Request {
  return new Request(`http://x/status${qs}`, { method: 'GET' });
}

beforeEach(() => {
  findUnique.mockReset();
  getOnRampTransaction.mockReset();
  update.mockReset().mockResolvedValue({});
  auditCreate.mockReset().mockResolvedValue({});
});

describe('GET /api/investidor/buy/onramp/status', () => {
  it('400 sem orderId', async () => {
    const r = await GET(req(''));
    expect(r.status).toBe(400);
  });

  it('404 quando order não existe', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await GET(req('?orderId=missing'));
    expect(r.status).toBe(404);
  });

  it('403 quando order é de outro investidor', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'ord_1',
      investidorId: 'inv_OUTRO',
      status: 'pending',
      stellarTxHash: null,
      paymentInstructionsJson: { __mock: false },
      settledAt: null,
    });
    const r = await GET(req('?orderId=ord_1'));
    expect(r.status).toBe(403);
  });

  it('200 happy path mock — não chama Etherfuse', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'ord_1',
      investidorId: 'inv_1',
      status: 'pending',
      stellarTxHash: null,
      paymentInstructionsJson: { __mock: true, pixKey: 'fake' },
      settledAt: null,
    });
    const r = await GET(req('?orderId=ord_1'));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.mock).toBe(true);
    expect(getOnRampTransaction).not.toHaveBeenCalled();
  });

  describe('limite de confirmação (U2 A-09): aditivo, só leitura', () => {
    // O status remoto é cacheado 5 s POR ORDEM (d1fd455): um id novo por teste evita ler o remoto de outro caso.
    let oid = 'ord_a09_0';
    let k = 0;
    beforeEach(() => { oid = `ord_a09_${++k}`; });
    const ha = (seg: number) => new Date(Date.now() - seg * 1000);
    const ordem = (over: Record<string, unknown> = {}) => ({
      id: oid,
      investidorId: 'inv_1',
      status: 'processing',
      stellarTxHash: null,
      stellarClaimableBalanceId: null,
      claimTxHash: null,
      paymentInstructionsJson: { __mock: false },
      settledAt: null,
      atualizadoEm: ha(300),
      ...over,
    });
    const dados = async (r: Response) => (await r.json()).data;

    it('real: processing sem claimable há 5 min → atrasada true, com desde e limiteSegundos 180', async () => {
      const antes = ha(300);
      findUnique.mockResolvedValueOnce(ordem({ atualizadoEm: antes }));
      getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null });
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ status: 'processing', atrasada: true, limiteSegundos: 180, desde: antes.toISOString() });
    });

    it('real: processing há 1 min → NÃO atrasada, mas já informa desde (a tela mostra o tempo decorrido)', async () => {
      const antes = ha(60);
      findUnique.mockResolvedValueOnce(ordem({ atualizadoEm: antes }));
      getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null });
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ atrasada: false, limiteSegundos: 180, desde: antes.toISOString() });
    });

    it('pending (ainda não pagou) → nunca atrasada e sem desde, mesmo antiga', async () => {
      findUnique.mockResolvedValueOnce(ordem({ status: 'pending', atualizadoEm: ha(6 * 3600) }));
      getOnRampTransaction.mockResolvedValueOnce({ status: 'pending', stellarTxHash: null, stellarClaimableBalanceId: null });
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ atrasada: false, desde: null });
    });

    it('processing COM claimable balance → não atrasada e sem desde (a tela segue para o claim)', async () => {
      findUnique.mockResolvedValueOnce(ordem({ stellarClaimableBalanceId: 'cb1', atualizadoEm: ha(6 * 3600) }));
      getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: 'cb1' });
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ atrasada: false, desde: null });
    });

    it('acabou de virar processing nesta consulta (pending → processing): desde é AGORA, não a data velha do pending, e não é atraso', async () => {
      findUnique.mockResolvedValueOnce(ordem({ status: 'pending', atualizadoEm: ha(6 * 3600) }));
      getOnRampTransaction.mockResolvedValueOnce({ status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null });
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d.atrasada).toBe(false);
      expect(Date.now() - Date.parse(d.desde)).toBeLessThan(5_000);
    });

    it('caminho "indexing" (o anchor ainda não indexou) também devolve os campos, sem mudar o resto', async () => {
      findUnique.mockResolvedValueOnce(ordem({ atualizadoEm: ha(400) }));
      getOnRampTransaction.mockResolvedValueOnce(null);
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ indexing: true, atrasada: true, limiteSegundos: 180 });
    });

    it('ordem mock em processing antiga também sinaliza (regra única, sem Etherfuse)', async () => {
      findUnique.mockResolvedValueOnce(ordem({ paymentInstructionsJson: { __mock: true }, atualizadoEm: ha(500) }));
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(getOnRampTransaction).not.toHaveBeenCalled();
      expect(d).toMatchObject({ mock: true, atrasada: true });
    });

    it('terminal (completed): atrasada false', async () => {
      findUnique.mockResolvedValueOnce(ordem({ status: 'completed', stellarClaimableBalanceId: 'cb1', claimTxHash: 'c', atualizadoEm: ha(6 * 3600) }));
      const d = await dados(await GET(req(`?orderId=${oid}`)));
      expect(d).toMatchObject({ status: 'completed', atrasada: false });
    });
  });
});

