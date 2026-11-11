import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst: m.findFirst } } }));

import { REFERENCIA_SWAP_MAX_IDADE_MS, obterPrecoReferenciaTesouro } from '@/lib/services/preco-referencia-tesouro';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = Date.parse('2026-11-11T12:00:00Z');
const DIA = 24 * 3600_000;
/** Swap escriturado `idadeMs` atrás. */
const swap = (idadeMs: number, over: Record<string, unknown> = {}) => ({
  fromAmount: D('100'), fee: '0.20', toAmount: D('85.52'), consumedAt: new Date(AGORA - idadeMs), ...over,
});

beforeEach(() => {
  delete process.env.PRECO_TESOURO_REF_BRL;
  m.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.PRECO_TESOURO_REF_BRL;
});

describe('obterPrecoReferenciaTesouro (Argus R2 + F7)', () => {
  it('usa o ÚLTIMO swap escriturado (consumido, TESOURO): (fromAmount − fee) ÷ toAmount', async () => {
    m.findFirst.mockResolvedValue(swap(DIA));
    const p = await obterPrecoReferenciaTesouro(AGORA);
    expect(p?.toDecimalPlaces(5).toString()).toBe('1.16698');
    expect(m.findFirst).toHaveBeenCalledWith({
      where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
      orderBy: { consumedAt: 'desc' },
      select: { fromAmount: true, fee: true, toAmount: true, consumedAt: true },
    });
  });

  it('F7: swap com até 7 dias manda sobre a config; exatamente 7 dias ainda vale', async () => {
    process.env.PRECO_TESOURO_REF_BRL = '9.99';
    m.findFirst.mockResolvedValue(swap(REFERENCIA_SWAP_MAX_IDADE_MS));
    expect((await obterPrecoReferenciaTesouro(AGORA))?.toDecimalPlaces(5).toString()).toBe('1.16698');
  });

  it('F7: swap de 60 dias NÃO vale: usa a config (e mudar a idade para 7 dias + 1 ms também)', async () => {
    process.env.PRECO_TESOURO_REF_BRL = '1.167';
    m.findFirst.mockResolvedValue(swap(60 * DIA, { fromAmount: D('100'), fee: '0', toAmount: D('100') })); // 1,00 de 60 dias atrás
    expect((await obterPrecoReferenciaTesouro(AGORA))?.toString()).toBe('1.167');
    m.findFirst.mockResolvedValue(swap(REFERENCIA_SWAP_MAX_IDADE_MS + 1));
    expect((await obterPrecoReferenciaTesouro(AGORA))?.toString()).toBe('1.167');
  });

  it('F7: swap de 60 dias e SEM config → null (o resgate recusa, fail-closed)', async () => {
    m.findFirst.mockResolvedValue(swap(60 * DIA));
    expect(await obterPrecoReferenciaTesouro(AGORA)).toBeNull();
  });

  it('sem swap escriturado, vale a config PRECO_TESOURO_REF_BRL', async () => {
    process.env.PRECO_TESOURO_REF_BRL = ' 1.30 ';
    expect((await obterPrecoReferenciaTesouro(AGORA))?.toString()).toBe('1.3');
  });

  it('swap recente com dados inválidos cai na config; config inválida/zero/negativa conta como ausente', async () => {
    m.findFirst.mockResolvedValue(swap(DIA, { toAmount: D('0') }));
    process.env.PRECO_TESOURO_REF_BRL = '1.40';
    expect((await obterPrecoReferenciaTesouro(AGORA))?.toString()).toBe('1.4');
    m.findFirst.mockResolvedValue(null);
    for (const bad of ['abc', '0', '-2', 'Infinity']) {
      process.env.PRECO_TESOURO_REF_BRL = bad;
      expect(await obterPrecoReferenciaTesouro(AGORA)).toBeNull();
    }
  });

  it('sem config e sem swap escriturado → null (o resgate recusa)', async () => {
    expect(await obterPrecoReferenciaTesouro(AGORA)).toBeNull();
  });
});
