import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ fetchSupplyDasClasses: vi.fn(), cotas: vi.fn(), realizacoes: vi.fn() }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => ({
  db: { cota: { findMany: m.cotas }, realizacaoCaminho: { findMany: m.realizacoes } },
}));

import { calcularPrecoDeEmissao } from '@/lib/services/emissao';
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
});
