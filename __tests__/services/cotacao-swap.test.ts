import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  fetchSupplyDasClasses: vi.fn(),
  cotas: vi.fn(),
  quoteUpdateMany: vi.fn(),
  quoteCreate: vi.fn(),
  orderUpdateMany: vi.fn(),
  tentativaEmFlight: vi.fn(),
}));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => {
  const tx = { quote: { create: m.quoteCreate }, onRampOrder: { updateMany: m.orderUpdateMany } };
  return {
    db: {
      tentativaEmissao: { findFirst: m.tentativaEmFlight }, // gate de emissão em voo (E1-4)
      cota: { findMany: m.cotas },
      movimentoFundo: { aggregate: async () => ({ _sum: { deltaCaixa: null } }) },
      quote: { updateMany: m.quoteUpdateMany, findFirst: async () => null }, // findFirst: nenhum swap em voo
      resgateCotacao: { findFirst: async () => null },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { COTACAO_RENOVADA_TTL_MS, renovarCotacaoParaSwap } from '@/lib/services/cotacao-swap';
import { NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (c: string) => ({ circulante: D(c), tesouraria: D('0') }) as never;
const AGORA = Date.parse('2026-11-10T12:00:00Z');

function quote(over: Record<string, unknown> = {}) {
  return {
    id: 'q_1', fromAmount: D('400'), toAmount: D('344'), expiresAt: new Date(AGORA + 60_000),
    consumedAt: null, submitXdrHash: null, investidorId: 'inv_1', fromCurrency: 'BRL', toCurrency: 'TESOURO',
    exchangeRate: '0.86', fee: '0', classe: 'SENIOR' as const, ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetNavSupplyCache();
  // A = 85.000 (cota), 80.000 emitidos → NAV 1,0625
  m.cotas.mockReset().mockResolvedValue([{ valorCarta: '100000', desagioAquisicao: '0.15', tokensEmitidos: '80000', status: 'DISPONIVEL' }]);
  m.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('80000'), subordinada: supply('0') });
  m.tentativaEmFlight.mockReset().mockResolvedValue(null);
  m.quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  m.quoteCreate.mockReset().mockResolvedValue({});
  m.orderUpdateMany.mockReset().mockResolvedValue({ count: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe('renovarCotacaoParaSwap (recotar)', () => {
  it('N1: q usa o valor LÍQUIDO do fee — R$ 450 com fee R$ 50 compra o mesmo que R$ 400 sem fee', async () => {
    const r = await renovarCotacaoParaSwap(
      quote({ fromAmount: D('450'), fee: '50', navPorTokenNaCotacao: D('1.0000'), plinarfAmount: D('450') }),
      AGORA,
    );
    expect(r.plinarfAmount.toFixed(7)).toBe('376.4705882'); // 400 ÷ 1,0625 (e não 450 ÷ 1,0625 = 423,5294117)
  });

  it('N1: fee que zera o valor ou inválido → 409, sem tocar no quote', async () => {
    await expect(renovarCotacaoParaSwap(quote({ fee: '400' }), AGORA)).rejects.toMatchObject({ status: 409 });
    await expect(renovarCotacaoParaSwap(quote({ fee: 'abc' }), AGORA)).rejects.toMatchObject({ status: 409 });
    expect(m.quoteUpdateMany).not.toHaveBeenCalled();
  });

  it('cotação vigente: relê o NAV e atualiza nav + plinarfAmount no próprio quote', async () => {
    const r = await renovarCotacaoParaSwap(quote({ navPorTokenNaCotacao: D('1.0000'), plinarfAmount: D('400') }), AGORA);
    expect(r).toMatchObject({ id: 'q_1', renovada: false });
    expect(r.navPorTokenNaCotacao.toFixed(8)).toBe('1.06250000');
    expect(r.plinarfAmount.toFixed(7)).toBe('376.4705882');
    const arg = m.quoteUpdateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'q_1', consumedAt: null, submitXdrHash: null });
    expect(arg.data.plinarfAmount.toFixed(7)).toBe('376.4705882');
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });

  it('o BRL e o TESOURO pagos não mudam; só a quantidade de PLINARF', async () => {
    await renovarCotacaoParaSwap(quote(), AGORA);
    const data = m.quoteUpdateMany.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['navPorTokenNaCotacao', 'plinarfAmount']);
  });

  it('cotação expirada (onramp já completed): cria quote NOVO com validade nova e religa a ordem', async () => {
    const r = await renovarCotacaoParaSwap(quote({ expiresAt: new Date(AGORA - 1_000) }), AGORA);
    expect(r.renovada).toBe(true);
    expect(r.id).not.toBe('q_1');
    const data = m.quoteCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: r.id, investidorId: 'inv_1', fromCurrency: 'BRL', toCurrency: 'TESOURO', classe: 'SENIOR' });
    expect(data.fromAmount.toFixed(2)).toBe('400.00');
    expect(data.toAmount.toFixed(2)).toBe('344.00');
    expect(data.expiresAt.getTime()).toBe(AGORA + COTACAO_RENOVADA_TTL_MS);
    expect(data.plinarfAmount.toFixed(7)).toBe('376.4705882');
    expect(m.orderUpdateMany).toHaveBeenCalledWith({ where: { quoteId: 'q_1' }, data: { quoteId: r.id } });
    expect(m.quoteUpdateMany).not.toHaveBeenCalled();
  });

  it('expirada sem ordem de onramp para religar → recusa (a transação desfaz)', async () => {
    m.orderUpdateMany.mockResolvedValue({ count: 0 });
    await expect(renovarCotacaoParaSwap(quote({ expiresAt: new Date(AGORA - 1) }), AGORA)).rejects.toMatchObject({ status: 409 });
  });

  it('já em submissão (submitXdrHash) → 409, sem mexer no preço da XDR em curso', async () => {
    await expect(renovarCotacaoParaSwap(quote({ submitXdrHash: 'h' }), AGORA)).rejects.toMatchObject({ status: 409 });
    expect(m.quoteUpdateMany).not.toHaveBeenCalled();
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });

  it('já consumida → 409', async () => {
    await expect(renovarCotacaoParaSwap(quote({ consumedAt: new Date() }), AGORA)).rejects.toMatchObject({ status: 409 });
  });

  it('atualização concorrente (count ≠ 1) → 409', async () => {
    m.quoteUpdateMany.mockResolvedValue({ count: 0 });
    await expect(renovarCotacaoParaSwap(quote(), AGORA)).rejects.toMatchObject({ status: 409 });
  });

  it('sem NAV (ledger fora / PLINARFB circulando) → NavIndisponivelError e nada é gravado', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('80000'), subordinada: supply('1') });
    await expect(renovarCotacaoParaSwap(quote(), AGORA)).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(m.quoteUpdateMany).not.toHaveBeenCalled();
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });

  it('E1-4 × N1: com uma emissão em voo o recotar falha fechado (EMISSAO_PENDENTE), sem tocar no quote', async () => {
    m.tentativaEmFlight.mockResolvedValue({ memoHash: 'abc' });
    await expect(renovarCotacaoParaSwap(quote(), AGORA)).rejects.toMatchObject({ name: 'NavIndisponivelError', motivo: 'EMISSAO_PENDENTE' });
    expect(m.quoteUpdateMany).not.toHaveBeenCalled();
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });
});
