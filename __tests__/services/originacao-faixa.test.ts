import { describe, it, expect } from 'vitest';
import { calcularFaixaIndicativa } from '@/lib/services/originacao';

describe('calcularFaixaIndicativa · componente de prazo (curva de yield provisória, §3.4)', () => {
  it('sem prazo informado, mantém o comportamento atual (só tipo de bem + administradora)', () => {
    const semPrazo = calcularFaixaIndicativa({
      tipoBem: 'VEICULO',
      administradora: 'Embracon Consórcios', // 150 bps
      valorCarta: '100000',
    });
    // range VEICULO 0.18-0.28 + anuência 0.015
    expect(semPrazo.desagioMinimo).toBeCloseTo(0.195, 6);
    expect(semPrazo.desagioMaximo).toBeCloseTo(0.295, 6);
  });

  it('prazo maior aumenta o deságio proporcionalmente (linear)', () => {
    const curto = calcularFaixaIndicativa({
      tipoBem: 'VEICULO',
      administradora: 'Embracon Consórcios',
      valorCarta: '100000',
      prazoRestanteMeses: 6,
    });
    const longo = calcularFaixaIndicativa({
      tipoBem: 'VEICULO',
      administradora: 'Embracon Consórcios',
      valorCarta: '100000',
      prazoRestanteMeses: 24,
    });
    expect(longo.desagioMinimo).toBeGreaterThan(curto.desagioMinimo);
    expect(longo.valorLiquidoMinimo).toBeLessThan(curto.valorLiquidoMinimo);
    // 24 meses = 4x o componente de prazo de 6 meses
    const semPrazo = calcularFaixaIndicativa({
      tipoBem: 'VEICULO',
      administradora: 'Embracon Consórcios',
      valorCarta: '100000',
    });
    const prazoCurto = curto.desagioMinimo - semPrazo.desagioMinimo;
    const prazoLongo = longo.desagioMinimo - semPrazo.desagioMinimo;
    expect(prazoLongo).toBeCloseTo(prazoCurto * 4, 6);
  });

  it('prazo <= 0 ou ausente não altera a faixa', () => {
    const base = calcularFaixaIndicativa({
      tipoBem: 'IMOVEL',
      administradora: 'Caixa',
      valorCarta: '200000',
    });
    const zerado = calcularFaixaIndicativa({
      tipoBem: 'IMOVEL',
      administradora: 'Caixa',
      valorCarta: '200000',
      prazoRestanteMeses: 0,
    });
    expect(zerado).toEqual(base);
  });
});
