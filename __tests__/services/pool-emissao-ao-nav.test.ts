import { describe, it, expect } from 'vitest';
import { Prisma, StatusCota } from '@prisma/client';
import {
  NAV_INICIAL_POR_TOKEN,
  navParaEmissao,
  navPorTokenAsDecimal,
  quantidadeEmitida,
} from '@/lib/services/pool';

const D = (v: string) => new Prisma.Decimal(v);

describe('quantidadeEmitida', () => {
  it('NAV 1,0625: R$ 400 → 376,4705882 PLINARF (376,47)', () => {
    const q = quantidadeEmitida(D('400'), D('1.0625'));
    expect(q.toFixed(7)).toBe('376.4705882');
    expect(q.toFixed(2)).toBe('376.47');
  });

  it('trunca (ROUND_DOWN) a 7 casas: nunca emite mais do que o BRL compra', () => {
    expect(quantidadeEmitida('100', '3').toFixed(7)).toBe('33.3333333');
    expect(quantidadeEmitida('200', '3').toFixed(7)).toBe('66.6666666'); // não ...667
  });

  it('NAV 1,00 → 1 token por R$ 1 (prova do SOW: R$ 400 → 400)', () => {
    expect(quantidadeEmitida(400, NAV_INICIAL_POR_TOKEN).toFixed(7)).toBe('400.0000000');
  });

  it('aceita string/number/Decimal', () => {
    expect(quantidadeEmitida('400', 1.0625).toFixed(7)).toBe('376.4705882');
  });

  it.each([['0'], ['-1'], ['0.0000000']])('NAV %s → lança (fail-closed)', (nav) => {
    expect(() => quantidadeEmitida('400', nav)).toThrow(RangeError);
  });

  it('valor negativo → lança', () => {
    expect(() => quantidadeEmitida('-1', '1')).toThrow(RangeError);
  });
});

describe('venda não dilui o NAV de quem já é holder', () => {
  // Fundo: NAV total 85.000 (cota 100.000 com 15% de deságio), 80.000 tokens
  // circulantes → NAV/token 1,0625. Entram R$ 400 de caixa (subscrição).
  const cota = {
    valorCarta: '100000',
    desagioAquisicao: '0.15',
    tokensEmitidos: '80000',
    status: StatusCota.DISPONIVEL,
  };

  it('NAV antes = NAV depois (a menos de 1 stroop de truncamento a favor do fundo)', () => {
    const supplyAntes = { circulante: '80000', tesouraria: '0' };
    const navAntes = navPorTokenAsDecimal([cota], [], supplyAntes);
    expect(navAntes.toFixed(4)).toBe('1.0625');

    const q = quantidadeEmitida('400', navAntes);
    // caixa da subscrição entra no numerador como realização de caixa
    const navDepois = navPorTokenAsDecimal(
      [cota],
      [{ valorRealizado: '400', spread: '0' }],
      { circulante: D('80000').plus(q), tesouraria: '0' },
    );
    expect(navDepois.toFixed(6)).toBe(navAntes.toFixed(6));
    // truncar nunca baixa o NAV de quem já detém token
    expect(navDepois.gte(navAntes)).toBe(true);
  });

  it('sem a fórmula (1 token por TESOURO/BRL) o NAV cai — o defeito que o M1-3 corrige', () => {
    const navAntes = navPorTokenAsDecimal([cota], [], { circulante: '80000', tesouraria: '0' });
    const navDiluido = navPorTokenAsDecimal(
      [cota],
      [{ valorRealizado: '400', spread: '0' }],
      { circulante: '80400', tesouraria: '0' },
    );
    expect(navDiluido.lt(navAntes)).toBe(true);
  });
});

describe('navParaEmissao', () => {
  it('supply circulante zero → NAV inicial R$ 1,00', () => {
    expect(navParaEmissao([], [], { circulante: '0', tesouraria: '0' }).toString()).toBe('1');
  });

  it('com circulante > 0 usa o NAV do ledger', () => {
    const cota = { valorCarta: '100000', desagioAquisicao: '0.15', tokensEmitidos: '80000', status: StatusCota.DISPONIVEL };
    expect(navParaEmissao([cota], [], { circulante: '80000', tesouraria: '0' }).toFixed(4)).toBe('1.0625');
  });

  it('NAV não positivo com circulante > 0 → lança (sem preço honesto não se emite)', () => {
    expect(() => navParaEmissao([], [], { circulante: '1000', tesouraria: '0' })).toThrow(RangeError);
  });
});
