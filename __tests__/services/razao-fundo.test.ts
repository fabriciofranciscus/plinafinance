import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, StatusCota } from '@prisma/client';

vi.mock('@/lib/db', () => ({ db: {} }));

import {
  backfillMovimentosFundo,
  caixaDoFundo,
  caixaParaNav,
  registrarMovimentoFundo,
} from '@/lib/services/razao-fundo';
import {
  navPorTokenAsDecimal,
  navTotalDoPool,
  quantidadeEmitida,
} from '@/lib/services/pool';

const D = (v: string | number) => new Prisma.Decimal(v);

/** Razão em memória com a mesma semântica de createMany(skipDuplicates) e aggregate. */
function razao() {
  const rows: Array<Record<string, any>> = [];
  const client = {
    movimentoFundo: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, any>> }) => {
        let count = 0;
        for (const d of data) {
          if (rows.some((r) => r.chave === d.chave)) continue;
          rows.push(d);
          count++;
        }
        return { count };
      }),
      aggregate: vi.fn(async () => ({
        _sum: { deltaCaixa: rows.length ? rows.reduce((s, r) => s.plus(r.deltaCaixa), D(0)) : null },
      })),
    },
    realizacaoCaminho: { findMany: vi.fn(async () => [] as any[]) },
    cota: { findMany: vi.fn(async () => [] as any[]) },
  };
  return { rows, client };
}

describe('registrarMovimentoFundo — efeito por tipo', () => {
  let r: ReturnType<typeof razao>;
  beforeEach(() => (r = razao()));

  it.each([
    ['SUBSCRICAO', { valorBrl: '400', tokens: '376.4705882' }, '400', '376.4705882'],
    ['APORTE_COTA', { valorBrl: '85000', tokens: '85000' }, '0', '85000'],
    ['AQUISICAO', { valorBrl: '85000' }, '-85000', '0'],
    ['REALIZACAO', { valorBrl: '95000' }, '95000', '0'],
    ['RESGATE_PAGO', { valorBrl: '4250', tokens: '4000' }, '-4250', '-4000'],
  ] as const)('%s', async (tipo, input, caixa, tokens) => {
    const res = await registrarMovimentoFundo(r.client as never, { tipo, chave: `k:${tipo}`, ...input });
    expect(res.criado).toBe(true);
    expect(r.rows[0].deltaCaixa.toString()).toBe(caixa);
    expect(r.rows[0].deltaTokens.toString()).toBe(tokens);
  });

  it('idempotente: mesma chave não duplica nem soma de novo', async () => {
    const a = await registrarMovimentoFundo(r.client as never, { tipo: 'REALIZACAO', valorBrl: 100, chave: 'realizacao:1' });
    const b = await registrarMovimentoFundo(r.client as never, { tipo: 'REALIZACAO', valorBrl: 100, chave: 'realizacao:1' });
    expect([a.criado, b.criado]).toEqual([true, false]);
    expect((await caixaDoFundo(r.client as never)).toString()).toBe('100');
  });

  it('recusa valor/tokens negativos, tipo sem tokens obrigatórios e AQUISICAO que emite', async () => {
    const c = r.client as never;
    await expect(registrarMovimentoFundo(c, { tipo: 'REALIZACAO', valorBrl: -1, chave: 'a' })).rejects.toThrow(RangeError);
    await expect(registrarMovimentoFundo(c, { tipo: 'SUBSCRICAO', valorBrl: 10, chave: 'b' })).rejects.toThrow(/tokens/);
    await expect(registrarMovimentoFundo(c, { tipo: 'RESGATE_PAGO', valorBrl: 10, tokens: 0, chave: 'c' })).rejects.toThrow(/tokens/);
    await expect(registrarMovimentoFundo(c, { tipo: 'AQUISICAO', valorBrl: 10, tokens: 5, chave: 'd' })).rejects.toThrow(/não emite/);
    await expect(registrarMovimentoFundo(c, { tipo: 'REALIZACAO', valorBrl: 1, chave: '' })).rejects.toThrow(/chave/);
    expect(r.rows).toHaveLength(0);
  });
});

describe('caixa do NAV vem do razão', () => {
  const cota = { valorCarta: '100000', desagioAquisicao: '0.15', tokensEmitidos: '80000', status: StatusCota.DISPONIVEL };

  it('razão vazio → caixa 0', async () => {
    const r = razao();
    expect((await caixaDoFundo(r.client as never)).toString()).toBe('0');
    expect((await caixaParaNav(r.client as never))[0].valorRealizado.toString()).toBe('0');
  });

  it('subscrição: caixa e tokens entram juntos → NAV por token não muda', async () => {
    const r = razao();
    const antes = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), { circulante: '80000', tesouraria: '0' });
    const q = quantidadeEmitida('400', antes);
    await registrarMovimentoFundo(r.client as never, { tipo: 'SUBSCRICAO', valorBrl: 400, tokens: q, chave: 'subscricao:q1' });
    const depois = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), { circulante: D(80000).plus(q), tesouraria: '0' });
    expect(depois.toFixed(6)).toBe(antes.toFixed(6));
    expect(depois.gte(antes)).toBe(true);
  });

  it('resgate pago com queima: NAV por token estável (aceite E2-5)', async () => {
    const r = razao();
    // fundo com R$ 20.000 de caixa de realizações + cota ativa; NAV total 105.000 / 100.000 tokens
    await registrarMovimentoFundo(r.client as never, { tipo: 'REALIZACAO', valorBrl: 20000, chave: 'realizacao:1' });
    const supplyAntes = { circulante: '100000', tesouraria: '0' };
    const navAntes = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), supplyAntes);
    expect(navAntes.toFixed(2)).toBe('1.05');

    // investidor resgata 40.000 tokens ao NAV: o fundo paga 40.000 × NAV e queima os tokens
    const q = D(40000);
    const pago = q.mul(navAntes);
    await registrarMovimentoFundo(r.client as never, { tipo: 'RESGATE_PAGO', valorBrl: pago, tokens: q, chave: 'resgate:xdr1' });
    const navDepois = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), { circulante: D(100000).minus(q), tesouraria: '0' });
    expect(navDepois.toFixed(6)).toBe(navAntes.toFixed(6));
  });

  it('resgate SEM queima derruba o NAV (por isso o burn, D2, é pré-requisito do M4)', async () => {
    const r = razao();
    await registrarMovimentoFundo(r.client as never, { tipo: 'REALIZACAO', valorBrl: 20000, chave: 'realizacao:1' });
    const navAntes = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), { circulante: '100000', tesouraria: '0' });
    const q = D(40000);
    await registrarMovimentoFundo(r.client as never, { tipo: 'RESGATE_PAGO', valorBrl: q.mul(navAntes), tokens: q, chave: 'resgate:xdr2' });
    // tokens voltam ao distributor (tesouraria ao par) em vez de serem queimados
    const navSemBurn = navPorTokenAsDecimal([cota], await caixaParaNav(r.client as never), { circulante: '60000', tesouraria: '40000' });
    expect(navSemBurn.lt(navAntes)).toBe(true);
  });

  it('NAV total usa o caixa do razão, não as realizações', async () => {
    const r = razao();
    await registrarMovimentoFundo(r.client as never, { tipo: 'REALIZACAO', valorBrl: 95000, chave: 'realizacao:9' });
    expect(navTotalDoPool([], await caixaParaNav(r.client as never))).toBe(95000);
  });
});

describe('backfillMovimentosFundo', () => {
  it('realizações → REALIZACAO; cotas incorporadas → APORTE_COTA pelo custo com q = tokens cunhados; idempotente', async () => {
    const r = razao();
    r.client.realizacaoCaminho.findMany.mockResolvedValue([
      { id: 'r1', cotaId: 'c9', valorRealizado: D('95000'), onChainTxHash: 'tx9' },
    ]);
    r.client.cota.findMany.mockResolvedValue([
      { id: 'c1', valorCarta: D('100000'), desagioAquisicao: D('0.15'), tokensEmitidos: D('85000'), emissaoTxHash: 'txE', hashValidacao: 'hv' },
    ]);
    const a = await backfillMovimentosFundo(r.client as never);
    const b = await backfillMovimentosFundo(r.client as never);
    expect(a).toEqual({ realizacoes: 1, aportes: 1 });
    expect(b).toEqual({ realizacoes: 0, aportes: 0 });
    const aporte = r.rows.find((x) => x.tipo === 'APORTE_COTA')!;
    expect(aporte.valorBrl.toString()).toBe('85000');
    expect(aporte.deltaTokens.toString()).toBe('85000');
    expect(aporte.deltaCaixa.toString()).toBe('0');
    expect(aporte.chave).toBe('aporte-cota:c1');
    // o caixa do razão após o backfill é igual ao antigo caixaRealizado (Σ valorRealizado)
    expect((await caixaDoFundo(r.client as never)).toString()).toBe('95000');
  });
});
