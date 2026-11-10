import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  fetchSupplyDasClasses: vi.fn(),
  parametros: vi.fn(),
  cotas: vi.fn(),
  realizacoes: vi.fn(),
}));

vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => ({
  db: {
    parametrosPool: { findUnique: m.parametros },
    tentativaEmissao: { findFirst: async () => null },
    cota: { findMany: m.cotas },
    realizacaoCaminho: { findMany: m.realizacoes },
    movimentoFundo: { aggregate: async () => ({ _sum: { deltaCaixa: null } }), createMany: async () => ({ count: 1 }) },
  },
}));
vi.mock('@/lib/env/feature-gates', () => ({ isSorobanWaterfallEnabled: async () => false }));

import { GET } from '@/app/api/pool/summary/route';
import { publicLimiter } from '@/lib/rate-limit/config';
import { resetNavSupplyCache, NAV_INDISPONIVEL_MENSAGEM } from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (code: string, circulante: string, tesouraria = '0') =>
  ({
    code,
    circulante: D(circulante),
    tesouraria: D(tesouraria),
    totalEmitido: D(circulante).plus(tesouraria),
    autorizado: D(circulante),
    naoAutorizado: D('0'),
    emTransito: D('0'),
    contas: { autorizadas: 1, autorizadasParaObrigacoes: 0, naoAutorizadas: 0 },
    temSaldoCongelado: false,
    lidoEm: new Date('2026-11-09T12:00:00Z'),
  }) as never;

const ledger = (subCirc = '0') => ({
  senior: supply('PLINARF', '80000'),
  subordinada: supply('PLINARFB', subCirc),
});

function req(ip = '10.1.1.1') {
  return new Request('http://x/api/pool/summary', { headers: { 'x-forwarded-for': ip } });
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetNavSupplyCache();
  await publicLimiter.reset();
  m.fetchSupplyDasClasses.mockReset().mockResolvedValue(ledger());
  m.parametros.mockReset().mockResolvedValue({ assetCode: 'OUTRO', network: 'TESTNET', issuerPubkey: 'GI', distributorPubkey: 'GD' });
  m.cotas.mockReset().mockResolvedValue([
    { tipoBem: 'VEICULO', valorCarta: '100000', desagioAquisicao: '0.20', tokensEmitidos: '80000', statusEstoque: 'x', status: 'DISPONIVEL', prazoRestanteMeses: 24 },
  ]);
  m.realizacoes.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/pool/summary', () => {
  it('200: NAV contra o supply da Sênior; assetCode vem da fonte única, não de ParametrosPool', async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    const { data } = await r.json();
    expect(data.assetCode).toBe('PLINARF');
    expect(data.supply.circulante).toBe('80000');
    expect(data.navPorToken).toBeCloseTo(1, 6);
  });

  it('fail-closed: Horizon fora → 503 LEDGER_UNAVAILABLE com mensagem constante, sem err.message', async () => {
    m.fetchSupplyDasClasses.mockRejectedValue(new Error('getaddrinfo ENOTFOUND horizon STELLAR_ISSUER_PUBLIC'));
    const r = await GET(req());
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('LEDGER_UNAVAILABLE');
    expect(body.error.message).toBe(NAV_INDISPONIVEL_MENSAGEM);
    expect(JSON.stringify(body)).not.toMatch(/ENOTFOUND|STELLAR_|horizon/i);
    expect(body.error.requestId).toBeTruthy();
  });

  it('trava D3: PLINARFB circulando → 503 idêntico (não revela o motivo)', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue(ledger('10'));
    const r = await GET(req());
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error.code).toBe('LEDGER_UNAVAILABLE');
    expect(body.error.message).toBe(NAV_INDISPONIVEL_MENSAGEM);
    expect(JSON.stringify(body)).not.toMatch(/PLINARFB|subordinada/i);
  });

  it('o 503 não consulta o banco (falha cedo)', async () => {
    m.fetchSupplyDasClasses.mockRejectedValue(new Error('x'));
    await GET(req());
    expect(m.cotas).not.toHaveBeenCalled();
  });

  it('2ª chamada dentro do TTL não vai ao Horizon', async () => {
    await GET(req());
    await GET(req());
    await GET(req());
    expect(m.fetchSupplyDasClasses).toHaveBeenCalledTimes(1);
  });

  it('429 acima do limite público, sem ler ledger nem banco', async () => {
    const calls: number[] = [];
    for (let i = 0; i < 25; i++) calls.push((await GET(req('10.9.9.9'))).status);
    expect(calls.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(calls[0]).toBe(200);
  });
});
