import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  fetchSupplyDasClasses: vi.fn(),
  cotas: vi.fn(),
  realizacoes: vi.fn(),
}));

vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => ({
  db: { tentativaEmissao: { findFirst: async () => null }, quote: { findFirst: async () => null }, cota: { findMany: m.cotas }, realizacaoCaminho: { findMany: m.realizacoes },
    movimentoFundo: { aggregate: async () => ({ _sum: { deltaCaixa: null } }), createMany: async () => ({ count: 1 }) } },
}));
// liquidacao.ts importa módulos com efeitos de rede/assinatura; só calcularValorLiquidacao é exercitado.
vi.mock('@/lib/stellar/account', () => ({ buildAsset: vi.fn(), horizon: {} }));
vi.mock('@/lib/stellar/signer', () => ({ distributorSigner: vi.fn() }));
vi.mock('@/lib/stellar/fee', () => ({ getDynamicFee: vi.fn() }));
vi.mock('@/lib/wallet/privy', () => ({ privySignatureToBase64: vi.fn() }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));

import { calcularValorLiquidacao } from '@/lib/services/liquidacao';
import { NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (circulante: string) => ({ circulante: D(circulante), tesouraria: D('0') }) as never;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetNavSupplyCache();
  m.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('80000'), subordinada: supply('0') });
  m.cotas.mockReset().mockResolvedValue([
    { valorCarta: '100000', desagioAquisicao: '0.20', tokensEmitidos: '80000', status: 'DISPONIVEL' },
  ]);
  m.realizacoes.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('calcularValorLiquidacao — trava D3 e fail-closed', () => {
  it('cotação normal contra o supply da Sênior', async () => {
    const r = await calcularValorLiquidacao({ amountPlinarf: '100' });
    expect(r.navPorTokenAtual).toBeCloseTo(1, 6);
    expect(r.brlEquivalente).toBeCloseTo(100, 2);
  });

  it('PLINARFB circulando → recusa a cotação (NavIndisponivelError)', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('80000'), subordinada: supply('1') });
    await expect(calcularValorLiquidacao({ amountPlinarf: '100' })).rejects.toMatchObject({
      name: 'NavIndisponivelError',
      motivo: 'SUBORDINADA_CIRCULANDO',
    });
  });

  it('Horizon fora → recusa a cotação, sem NAV 1 nem estado da app', async () => {
    m.fetchSupplyDasClasses.mockRejectedValue(new Error('timeout'));
    await expect(calcularValorLiquidacao({ amountPlinarf: '100' })).rejects.toBeInstanceOf(NavIndisponivelError);
  });

  it('NAV não positivo → NavIndisponivelError (mensagem pública constante)', async () => {
    m.cotas.mockResolvedValue([]); // nada atribuível contra supply circulante > 0
    const err = await calcularValorLiquidacao({ amountPlinarf: '100' }).catch((e) => e);
    expect(err).toBeInstanceOf(NavIndisponivelError);
    expect(err.motivo).toBe('NAV_NAO_POSITIVO');
    expect(err.message).not.toMatch(/operador|reconciliar|atribuível/i);
  });

  it('cotação de resgate não usa o TTL: lê o ledger a cada chamada', async () => {
    await calcularValorLiquidacao({ amountPlinarf: '1' });
    await calcularValorLiquidacao({ amountPlinarf: '1' });
    expect(m.fetchSupplyDasClasses).toHaveBeenCalledTimes(2);
  });

  it('PLINARFB que aparece entre duas cotações derruba a segunda', async () => {
    await calcularValorLiquidacao({ amountPlinarf: '1' });
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('80000'), subordinada: supply('3') });
    await expect(calcularValorLiquidacao({ amountPlinarf: '1' })).rejects.toBeInstanceOf(NavIndisponivelError);
  });
});
