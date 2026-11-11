import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { assertClasseDisponivel, valorLiquidoDaCotacao } from '@/lib/services/regras-swap';

describe('assertClasseDisponivel (N1: Subordinada sem NAV próprio)', () => {
  it('recusa SUBORDINADA com erro próprio (422 CLASSE_INDISPONIVEL)', () => {
    try {
      assertClasseDisponivel('SUBORDINADA');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('CLASSE_INDISPONIVEL');
      expect((e as ApiError).status).toBe(422);
      expect((e as ApiError).message).toMatch(/Subordinada/);
    }
  });

  it('aceita SENIOR, ausente e nulo (default Sênior)', () => {
    expect(() => assertClasseDisponivel('SENIOR')).not.toThrow();
    expect(() => assertClasseDisponivel(undefined)).not.toThrow();
    expect(() => assertClasseDisponivel(null)).not.toThrow();
  });
});

describe('valorLiquidoDaCotacao (N1: V = BRL pago − fee da Etherfuse)', () => {
  it('fee ≠ 0: R$ 10.000 com fee R$ 50 → V = 9.950 (o fundo recebe o TESOURO líquido)', () => {
    const v = valorLiquidoDaCotacao({ fromAmount: new Prisma.Decimal('10000'), fee: '50' });
    expect(v.toFixed(7)).toBe('9950.0000000');
  });

  it('fee decimal e 7 casas', () => {
    expect(valorLiquidoDaCotacao({ fromAmount: '100', fee: '0.5' }).toFixed(7)).toBe('99.5000000');
    expect(valorLiquidoDaCotacao({ fromAmount: '100.1234567', fee: '0.0000001' }).toFixed(7)).toBe('100.1234566');
  });

  it('fee 0, vazio, nulo ou ausente = sem desconto', () => {
    for (const fee of ['0', '', '  ', null, undefined]) {
      expect(valorLiquidoDaCotacao({ fromAmount: '100', fee }).toFixed(2)).toBe('100.00');
    }
  });

  it('fee inválido, negativo ou que zera o valor → cotação recusada (409)', () => {
    for (const fee of ['abc', '-1', 'NaN', 'Infinity', '100', '150']) {
      expect(() => valorLiquidoDaCotacao({ fromAmount: '100', fee }), fee).toThrowError(ApiError);
    }
    try {
      valorLiquidoDaCotacao({ fromAmount: '100', fee: 'abc' });
    } catch (e) {
      expect((e as ApiError).status).toBe(409);
    }
  });
});
