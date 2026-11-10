import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma, StatusCota } from '@prisma/client';

const m = vi.hoisted(() => ({ fetchSupplyDasClasses: vi.fn(), cotas: vi.fn(), realizacoes: vi.fn() }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => ({
  db: { cota: { findMany: m.cotas }, realizacaoCaminho: { findMany: m.realizacoes },
    movimentoFundo: { aggregate: async () => ({ _sum: { deltaCaixa: null } }), createMany: async () => ({ count: 1 }) } },
}));

import { calcularPrecoDeEmissao } from '@/lib/services/emissao';
import { navPorTokenAsDecimal } from '@/lib/services/pool';
import { NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (c: string) => ({ circulante: D(c), tesouraria: D('0') }) as never;
const cota = { valorCarta: '100000', desagioAquisicao: '0.15', tokensEmitidos: '80000', status: 'DISPONIVEL' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetNavSupplyCache();
  m.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('80000'), subordinada: supply('0') });
  m.cotas.mockReset().mockResolvedValue([cota]);
  m.realizacoes.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('calcularPrecoDeEmissao', () => {
  it('NAV 1,0625: R$ 400 → 376,4705882 PLINARF, NAV congelado a 8 casas', async () => {
    const r = await calcularPrecoDeEmissao({ valorBrl: '400' });
    expect(r.navPorTokenNaCotacao.toFixed(8)).toBe('1.06250000');
    expect(r.plinarfAmount.toFixed(7)).toBe('376.4705882');
  });

  it('supply zero → NAV 1,00: R$ 400 → 400 PLINARF (prova do SOW)', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
    const r = await calcularPrecoDeEmissao({ valorBrl: '400' });
    expect(r.plinarfAmount.toFixed(7)).toBe('400.0000000');
  });

  it('PLINARFB circulando (D3) → recusa', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('80000'), subordinada: supply('1') });
    await expect(calcularPrecoDeEmissao({ valorBrl: '400' })).rejects.toBeInstanceOf(NavIndisponivelError);
  });

  it('Horizon fora → recusa', async () => {
    m.fetchSupplyDasClasses.mockRejectedValue(new Error('x'));
    await expect(calcularPrecoDeEmissao({ valorBrl: '400' })).rejects.toBeInstanceOf(NavIndisponivelError);
  });

  it('NAV não positivo → NavIndisponivelError', async () => {
    m.cotas.mockResolvedValue([]);
    await expect(calcularPrecoDeEmissao({ valorBrl: '400' })).rejects.toMatchObject({ motivo: 'NAV_NAO_POSITIVO' });
  });

  it('valor que compra 0 token → 400', async () => {
    await expect(calcularPrecoDeEmissao({ valorBrl: '0.0000001' })).rejects.toMatchObject({ status: 400 });
  });

  it('N1: subscrição de R$ 10.416,67 a NAV 1,0417 emite ~10.000 tokens (supply +10.000) e o NAV não muda', async () => {
    // A = R$ 250.000 (cota ativa), N = 240.000 emitidos → NAV 1,04166667.
    m.cotas.mockResolvedValue([{ valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '240000', status: 'DISPONIVEL' }]);
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('240000'), subordinada: supply('0') });
    const antes = navPorTokenAsDecimal(
      [{ valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '240000', status: StatusCota.DISPONIVEL }], [{ valorRealizado: 0 }],
      { circulante: '240000', tesouraria: '0' },
    );
    expect(antes.toFixed(4)).toBe('1.0417');

    const r = await calcularPrecoDeEmissao({ valorBrl: '10416.67' });
    expect(r.navPorTokenNaCotacao.toFixed(8)).toBe(antes.toFixed(8));
    expect(r.plinarfAmount.toFixed(2)).toBe('10000.00'); // supply +10.000

    // depois da subscrição: caixa +BRL no numerador, N +q no denominador
    const depois = navPorTokenAsDecimal(
      [{ valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '240000', status: StatusCota.DISPONIVEL }],
      [{ valorRealizado: '10416.67' }],
      { circulante: D('240000').plus(r.plinarfAmount), tesouraria: '0' },
    );
    expect(depois.toFixed(6)).toBe(antes.toFixed(6));
    expect(depois.gte(antes.minus('0.00000001'))).toBe(true);
  });

  it('N1: NAV inicial 1,00 só quando o supply TOTAL (circulante + posição da Plina + distributor) é zero', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: { circulante: D('0'), tesouraria: D('0') } as never, subordinada: supply('0') });
    expect((await calcularPrecoDeEmissao({ valorBrl: '400' })).navPorTokenNaCotacao.toString()).toBe('1');

    // tokens só na posição da Plina (circulante > 0, nada em investidores): NAV do ledger, não 1,00
    m.cotas.mockResolvedValue([{ valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '240000', status: 'DISPONIVEL' }]);
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('240000'), subordinada: supply('0') });
    resetNavSupplyCache();
    expect((await calcularPrecoDeEmissao({ valorBrl: '400' })).navPorTokenNaCotacao.toFixed(4)).toBe('1.0417');
  });
});
