import { describe, it, expect } from 'vitest';
import { Prisma, StatusCota } from '@prisma/client';
import {
  navDaCota,
  navDaCotaAsDecimal,
  caixaRealizadoAsDecimal,
  navTotalDoPoolAsDecimal,
  navPorTokenAsDecimal,
  tokensParaEmitir,
} from '@/lib/services/pool';

describe('pool precision — F-10', () => {
  it('navDaCota com R$10M+ e desagio fracionário preserva centavos', () => {
    const cota = { valorCarta: '10000000.55', desagioAquisicao: '0.001' };
    const nav = navDaCotaAsDecimal(cota);
    // 10000000.55 * 0.999 = 9990000.549449...
    expect(nav.toFixed(2)).toBe('9990000.55');
    expect(navDaCota(cota)).toBeCloseTo(9990000.55, 2);
  });

  it('caixaRealizado soma Decimal sem drift', () => {
    const reals = [
      { valorRealizado: '12345678.91' },
      { valorRealizado: '12345678.91' },
      { valorRealizado: '12345678.91' },
    ];
    expect(caixaRealizadoAsDecimal(reals).toFixed(2)).toBe('37037036.73');
  });

  it('navTotalDoPool integra cotas Decimal e caixa Decimal', () => {
    const cotas = [
      {
        valorCarta: '5000000.00',
        desagioAquisicao: '0.20',
        tokensEmitidos: '4000000',
        status: StatusCota.DISPONIVEL,
      },
    ];
    const reals = [{ valorRealizado: '1000000.55' }];
    expect(navTotalDoPoolAsDecimal(cotas, reals).toFixed(2)).toBe('5000000.55');
  });

  it('navPorToken retorna Decimal com 8 casas', () => {
    const cotas = [
      {
        valorCarta: '1000000',
        desagioAquisicao: '0',
        tokensEmitidos: '999999',
        status: StatusCota.DISPONIVEL,
      },
    ];
    const unit = navPorTokenAsDecimal(cotas, []);
    expect(unit.toFixed(8)).toBe('1.00000100');
  });

  it('tokensParaEmitir trunca pra inteiro (paridade NAV)', () => {
    expect(
      tokensParaEmitir({
        valorCarta: '250000',
        desagioAquisicao: '0.18',
      }),
    ).toBe(205000);
  });

  it('navDaCotaAsDecimal aceita Prisma.Decimal nos inputs', () => {
    const cota = {
      valorCarta: new Prisma.Decimal('100000.00'),
      desagioAquisicao: new Prisma.Decimal('0.15'),
    };
    expect(navDaCotaAsDecimal(cota).toFixed(2)).toBe('85000.00');
  });
});
