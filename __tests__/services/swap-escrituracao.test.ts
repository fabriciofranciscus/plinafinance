import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  fetchTx: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  incrementarHolding: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    quote: { updateMany: m.updateMany },
    investidor: { update: m.investidorUpdate },
    eventoAudit: { create: m.eventoCreate },
    movimentoFundo: { createMany: m.movimentoCreateMany },
  };
  return {
    db: {
      quote: { findMany: m.findMany, updateMany: m.updateMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/stellar/transactions', () => ({ fetchTransactionByHash: m.fetchTx }));
vi.mock('@/lib/services/holdings', () => ({ incrementarHolding: m.incrementarHolding }));

import { reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = Date.parse('2026-11-10T12:00:00Z');
const sec = (ms: number) => Math.floor(ms / 1000);

function orfa(over: Record<string, unknown> = {}) {
  return {
    id: 'q_1', investidorId: 'inv_1', fromAmount: D('150'), fee: '50', classe: 'SENIOR',
    plinarfAmount: D('99.5'), submitXdrHash: 'xh1', submitTxHash: 'th1',
    submitMaxTime: new Date(AGORA + 60_000), onRampOrder: { id: 'ord_1' }, ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.findMany.mockReset().mockResolvedValue([]);
  m.updateMany.mockReset().mockResolvedValue({ count: 1 });
  m.fetchTx.mockReset();
  m.investidorUpdate.mockReset().mockResolvedValue({});
  m.eventoCreate.mockReset().mockResolvedValue({});
  m.movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  m.incrementarHolding.mockReset().mockResolvedValue(undefined);
});

describe('reconciliarSwapsOrfaos (N1)', () => {
  it('tx on-chain com SUCESSO: escritura sem o investidor (caixa líquido do fee, audit do reconciliador)', async () => {
    m.findMany.mockResolvedValue([orfa()]);
    m.fetchTx.mockResolvedValue({ hash: 'th1', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ escriturados: 1, liberados: 0, aguardando: 0, semHash: 0, erros: 0 });
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'q_1', consumedAt: null }, data: { consumedTxHash: 'th1' } });
    expect(m.investidorUpdate).toHaveBeenCalledOnce();
    expect(m.incrementarHolding).toHaveBeenCalledOnce();
    const mov = m.movimentoCreateMany.mock.calls[0][0].data[0];
    expect(mov.tipo).toBe('SUBSCRICAO');
    expect(new Prisma.Decimal(mov.valorBrl).toFixed(2)).toBe('100.00'); // 150 − 50
    const audit = m.eventoCreate.mock.calls[0][0].data;
    expect(audit.acao).toBe('SWAP_EXECUTADO');
    expect(audit.operador).toBe('reconciliador-swap');
    expect(audit.privyId).toBeNull();
  });

  it('tx on-chain com FALHA: libera a reserva (prova positiva), não escritura', async () => {
    m.findMany.mockResolvedValue([orfa()]);
    m.fetchTx.mockResolvedValue({ hash: 'th1', successful: false });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ escriturados: 0, liberados: 1 });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'q_1', submitXdrHash: 'xh1', consumedAt: null },
      data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null },
    });
    expect(m.investidorUpdate).not.toHaveBeenCalled();
  });

  it('fora da chain e VENCIDA: NÃO libera por "não achei" (sem prova); fica órfã para o operador', async () => {
    m.findMany.mockResolvedValue([orfa({ submitMaxTime: new Date(AGORA - 3_600_000) })]); // venceu há 1 h
    m.fetchTx.mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ vencidasSemProva: 1, liberados: 0, aguardando: 0, escriturados: 0 });
    expect(m.updateMany).not.toHaveBeenCalled(); // nada liberado, nada escriturado
  });

  it('fora da chain e ainda DENTRO do prazo do envelope → aguardando, nada muda', async () => {
    m.findMany.mockResolvedValue([orfa({ submitMaxTime: new Date(AGORA + 30_000) })]);
    m.fetchTx.mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ aguardando: 1, vencidasSemProva: 0, liberados: 0 });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('reserva sem maxTime gravado e fora da chain: sem prova (nunca libera)', async () => {
    m.findMany.mockResolvedValue([orfa({ submitMaxTime: null })]);
    m.fetchTx.mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ vencidasSemProva: 1, liberados: 0 });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('sem submitTxHash (anterior à migration): não toca, vai para o operador', async () => {
    m.findMany.mockResolvedValue([orfa({ submitTxHash: null })]);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.semHash).toBe(1);
    expect(m.fetchTx).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('Horizon fora: conta o erro, mantém a reserva e segue as demais', async () => {
    m.findMany.mockResolvedValue([orfa({ id: 'a' }), orfa({ id: 'b', submitXdrHash: 'xh2', submitTxHash: 'th2' })]);
    m.fetchTx.mockRejectedValueOnce(new Error('horizon fora')).mockResolvedValueOnce({ hash: 'th2', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ erros: 1, escriturados: 1 });
  });

  it('commit que falha (quote consumido ao mesmo tempo) conta erro, sem derrubar o lote', async () => {
    m.findMany.mockResolvedValue([orfa()]);
    m.fetchTx.mockResolvedValue({ hash: 'th1', successful: true });
    m.updateMany.mockResolvedValue({ count: 0 }); // consumido por outro
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ erros: 1, escriturados: 0 });
  });

  it('sem ordem de onramp ou sem preço: não escritura às cegas (erro)', async () => {
    m.findMany.mockResolvedValue([orfa({ onRampOrder: null }), orfa({ id: 'b', submitXdrHash: 'x2', submitTxHash: 't2', plinarfAmount: null })]);
    m.fetchTx.mockResolvedValue({ hash: 'th', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.erros).toBe(2);
    expect(m.investidorUpdate).not.toHaveBeenCalled();
  });
});
