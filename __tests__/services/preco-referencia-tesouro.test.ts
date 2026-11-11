import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { quote: { findFirst: m.findFirst } } }));

import { obterPrecoReferenciaTesouro } from '@/lib/services/preco-referencia-tesouro';

const D = (v: string) => new Prisma.Decimal(v);

beforeEach(() => {
  delete process.env.PRECO_TESOURO_REF_BRL;
  m.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.PRECO_TESOURO_REF_BRL;
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

  it('sem swap escriturado, vale a config PRECO_TESOURO_REF_BRL', async () => {
    process.env.PRECO_TESOURO_REF_BRL = ' 1.30 ';
    expect((await obterPrecoReferenciaTesouro())?.toString()).toBe('1.3');
  });

  it('o último swap tem prioridade sobre a config', async () => {
    process.env.PRECO_TESOURO_REF_BRL = '9.99';
    m.findFirst.mockResolvedValue({ fromAmount: D('100'), fee: '0', toAmount: D('80') });
    expect((await obterPrecoReferenciaTesouro())?.toString()).toBe('1.25');
  });

  it('swap com dados inválidos cai na config; config inválida/zero/negativa conta como ausente', async () => {
    m.findFirst.mockResolvedValue({ fromAmount: D('100'), fee: '0', toAmount: D('0') });
    process.env.PRECO_TESOURO_REF_BRL = '1.40';
    expect((await obterPrecoReferenciaTesouro())?.toString()).toBe('1.4');
    m.findFirst.mockResolvedValue(null);
    for (const bad of ['abc', '0', '-2', 'Infinity']) {
      process.env.PRECO_TESOURO_REF_BRL = bad;
      expect(await obterPrecoReferenciaTesouro()).toBeNull();
    }
  });

  it('sem config e sem swap escriturado → null (o resgate recusa)', async () => {
    expect(await obterPrecoReferenciaTesouro()).toBeNull();
  });
});
