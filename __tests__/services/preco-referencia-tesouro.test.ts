import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst: m.findFirst } } }));

import { obterPrecoReferenciaTesouro } from '@/lib/services/preco-referencia-tesouro';

const D = (v: string) => new Prisma.Decimal(v);

beforeEach(() => {
  delete process.env.RESGATE_PRECO_TESOURO_REF;
  m.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.RESGATE_PRECO_TESOURO_REF;
});

describe('obterPrecoReferenciaTesouro (Argus R2)', () => {
  it('usa o ÚLTIMO swap escriturado (consumido, TESOURO): (fromAmount − fee) ÷ toAmount', async () => {
    m.findFirst.mockResolvedValue({ fromAmount: D('100'), fee: '0.20', toAmount: D('85.52') });
    const p = await obterPrecoReferenciaTesouro();
    expect(p?.toDecimalPlaces(5).toString()).toBe('1.16698');
    expect(m.findFirst).toHaveBeenCalledWith({
      where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
      orderBy: { consumedAt: 'desc' },
      select: { fromAmount: true, fee: true, toAmount: true },
    });
  });

  it('a config RESGATE_PRECO_TESOURO_REF tem prioridade e dispensa o banco', async () => {
    process.env.RESGATE_PRECO_TESOURO_REF = ' 1.30 ';
    expect((await obterPrecoReferenciaTesouro())?.toString()).toBe('1.3');
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('config inválida/zero/negativa é ignorada e cai no último swap', async () => {
    m.findFirst.mockResolvedValue({ fromAmount: D('100'), fee: '0', toAmount: D('80') });
    for (const bad of ['abc', '0', '-2', 'Infinity']) {
      process.env.RESGATE_PRECO_TESOURO_REF = bad;
      expect((await obterPrecoReferenciaTesouro())?.toString()).toBe('1.25');
    }
  });

  it('sem config e sem swap escriturado → null (o resgate recusa); swap com dados inválidos → null', async () => {
    expect(await obterPrecoReferenciaTesouro()).toBeNull();
    m.findFirst.mockResolvedValue({ fromAmount: D('100'), fee: '0', toAmount: D('0') });
    expect(await obterPrecoReferenciaTesouro()).toBeNull();
  });
});
