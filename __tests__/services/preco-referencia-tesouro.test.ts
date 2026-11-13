import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst: m.findFirst } } }));

import {
  REFERENCIA_MAX_IDADE_DIAS,
  corrigirReferencia,
  obterPrecoReferenciaTesouro,
} from '@/lib/services/preco-referencia-tesouro';
import { precoNaFaixa } from '@/lib/services/regras-resgate';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = Date.parse('2026-11-11T12:00:00Z');
const DIA = 24 * 3600_000;
const ENVS = ['PRECO_TESOURO_REF_BRL', 'PRECO_TESOURO_REF_DATA', 'TESOURO_TAXA_ANUAL'] as const;
/** Swap escriturado `idadeMs` atrás: (100 − 0,20) ÷ 85,52 = 1,16698. */
const swap = (idadeMs: number, over: Record<string, unknown> = {}) => ({
  fromAmount: D('100'), fee: '0.20', toAmount: D('85.52'), consumedAt: new Date(AGORA - idadeMs), ...over,
});
const config = (preco: string, idadeMs: number) => {
  process.env.PRECO_TESOURO_REF_BRL = preco;
  process.env.PRECO_TESOURO_REF_DATA = new Date(AGORA - idadeMs).toISOString();
};
const ok = async () => {
  const r = await obterPrecoReferenciaTesouro(AGORA);
  if (r.status !== 'OK') throw new Error(`esperava OK, veio ${r.status}`);
  return r;
};

beforeEach(() => {
  for (const k of ENVS) delete process.env[k];
  m.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  for (const k of ENVS) delete process.env[k];
});

describe('obterPrecoReferenciaTesouro (Argus R2 + F7, regra da Consuelo)', () => {
  it('só o último swap escriturado: (fromAmount − fee) ÷ toAmount, origem SWAP', async () => {
    m.findFirst.mockResolvedValue(swap(DIA));
    const r = await ok();
    expect(r.origem).toBe('SWAP');
    expect(r.preco.toDecimalPlaces(5).toString()).toBe('1.16698');
    expect(m.findFirst).toHaveBeenCalledWith({
      where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
      orderBy: { consumedAt: 'desc' },
      select: { fromAmount: true, fee: true, toAmount: true, consumedAt: true },
    });
  });

  it('só a config (preço + data): origem CONFIG', async () => {
    config('1.167', 2 * DIA);
    const r = await ok();
    expect(r.origem).toBe('CONFIG');
    expect(r.preco.toString()).toBe('1.167');
  });

  it('vale o ponto MAIS RECENTE: swap de 2 d vence config de 5 d; config de 1 d vence swap de 3 d', async () => {
    m.findFirst.mockResolvedValue(swap(2 * DIA));
    config('9.99', 5 * DIA);
    expect((await ok()).origem).toBe('SWAP');
    m.findFirst.mockResolvedValue(swap(3 * DIA));
    config('1.30', 1 * DIA);
    const r = await ok();
    expect(r.origem).toBe('CONFIG');
    expect(r.preco.toString()).toBe('1.3');
  });

  it('config sem data (ou data inválida) ou preço inválido NÃO é candidata', async () => {
    process.env.PRECO_TESOURO_REF_BRL = '1.30';
    expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('AUSENTE');
    process.env.PRECO_TESOURO_REF_DATA = 'ontem';
    expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('AUSENTE');
    for (const bad of ['abc', '0', '-2', 'Infinity', '']) {
      config(bad, DIA);
      expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('AUSENTE');
    }
  });

  it('swap recente com dados inválidos é ignorado e cai na config', async () => {
    m.findFirst.mockResolvedValue(swap(DIA, { toAmount: D('0') }));
    config('1.40', 2 * DIA);
    const r = await ok();
    expect(r.origem).toBe('CONFIG');
  });

  it('sem swap e sem config → AUSENTE (recusa)', async () => {
    expect(await obterPrecoReferenciaTesouro(AGORA)).toEqual({ status: 'AUSENTE' });
  });
});

describe('correção pós-fixada: (1 + TESOURO_TAXA_ANUAL)^(dias/365) e faixa ±2% sobre a corrigida', () => {
  it('exemplo da Consuelo (1,1663, 14% a.a.) com 29 dias: a cotação de 1,19 passa COM a correção e seria recusada SEM ela', async () => {
    process.env.TESOURO_TAXA_ANUAL = '0.14';
    config('1.1663', 29 * DIA);
    const r = await ok();
    const esperado = 1.1663 * Math.pow(1.14, 29 / 365); // conta independente
    expect(Number(r.preco.toString())).toBeCloseTo(esperado, 6);
    expect(r.base.toString()).toBe('1.1663');
    expect(precoNaFaixa('1.19', r.preco)).toBe(true); // +0,97% sobre a corrigida
    expect(precoNaFaixa('1.19', r.base)).toBe(false); // +2,03% sobre a parada
  });

  it('a faixa continua ±2% sobre a corrigida: acima/abaixo recusam', async () => {
    process.env.TESOURO_TAXA_ANUAL = '0.14';
    config('1.1663', 29 * DIA);
    const r = await ok();
    expect(precoNaFaixa(r.preco.mul('1.0201'), r.preco)).toBe(false);
    expect(precoNaFaixa(r.preco.mul('0.9799'), r.preco)).toBe(false);
    expect(precoNaFaixa(r.preco.mul('1.0199'), r.preco)).toBe(true);
  });

  it('o swap também é corrigido desde o consumedAt', async () => {
    process.env.TESOURO_TAXA_ANUAL = '0.14';
    m.findFirst.mockResolvedValue(swap(10 * DIA));
    const r = await ok();
    expect(Number(r.preco.toString())).toBeCloseTo((99.8 / 85.52) * Math.pow(1.14, 10 / 365), 6);
  });

  it('taxa ausente, inválida ou negativa = sem correção', async () => {
    config('1.1663', 20 * DIA);
    for (const t of [undefined, '', 'abc', '-0.1', 'Infinity']) {
      if (t === undefined) delete process.env.TESOURO_TAXA_ANUAL;
      else process.env.TESOURO_TAXA_ANUAL = t;
      expect((await ok()).preco.toString()).toBe('1.1663');
    }
  });

  it('corrigirReferencia: data no futuro conta como 0 dia (sem correção)', () => {
    expect(corrigirReferencia(D('1.1663'), AGORA + 5 * DIA, AGORA, D('0.14')).toString()).toBe('1.1663');
  });
});

describe('idade máxima de 30 dias (fail-closed, F7)', () => {
  it('exatamente 30 dias ainda vale; 30 dias + 1 ms é VENCIDA', async () => {
    config('1.167', REFERENCIA_MAX_IDADE_DIAS * DIA);
    expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('OK');
    config('1.167', REFERENCIA_MAX_IDADE_DIAS * DIA + 1);
    expect(await obterPrecoReferenciaTesouro(AGORA)).toMatchObject({ status: 'VENCIDA', origem: 'CONFIG' });
  });

  it('referência de 31 dias → VENCIDA (swap e config)', async () => {
    m.findFirst.mockResolvedValue(swap(31 * DIA));
    expect(await obterPrecoReferenciaTesouro(AGORA)).toMatchObject({ status: 'VENCIDA', origem: 'SWAP' });
    for (const k of ENVS) delete process.env[k];
    m.findFirst.mockResolvedValue(null);
    config('1.167', 31 * DIA);
    expect(await obterPrecoReferenciaTesouro(AGORA)).toMatchObject({ status: 'VENCIDA', origem: 'CONFIG' });
  });

  it('o exemplo de 60 dias da Consuelo cai no teto de 30 dias: VENCIDA (não passa nem com a correção)', async () => {
    process.env.TESOURO_TAXA_ANUAL = '0.14';
    config('1.1663', 60 * DIA);
    expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('VENCIDA');
  });

  it('a mais recente é que conta: swap velho + config recente = OK; swap recente + config velha = OK (SWAP)', async () => {
    m.findFirst.mockResolvedValue(swap(60 * DIA));
    config('1.167', 3 * DIA);
    expect((await obterPrecoReferenciaTesouro(AGORA)).status).toBe('OK');
    config('1.167', 60 * DIA);
    m.findFirst.mockResolvedValue(swap(3 * DIA));
    expect(await obterPrecoReferenciaTesouro(AGORA)).toMatchObject({ status: 'OK', origem: 'SWAP' });
  });
});
