import { describe, it, expect } from 'vitest';
import { StatusCota } from '@prisma/client';
import {
  navAtribuivelAsDecimal,
  navPorTokenAsDecimal,
  navTotalDoPoolAsDecimal,
  tokensEmitidosVivos,
} from '@/lib/services/pool';

/**
 * O NAV/token passou a ser precificado contra o supply circulante lido do
 * ledger, não contra `tokensEmitidos` das cotas ativas. Estes testes fixam os
 * dois defeitos que a mudança corrige, nos cenários em que eles apareciam.
 *
 * Cenário-base, que vale pra quase todos os casos abaixo: uma cota de
 * R$ 100.000 com 20% de deságio → NAV R$ 80.000, 80.000 tokens cunhados em
 * paridade.
 */

const cotaAtiva = {
  valorCarta: '100000',
  desagioAquisicao: '0.20',
  tokensEmitidos: '80000',
  status: StatusCota.DISPONIVEL,
};

/** Supply com tudo vendido: nada em tesouraria. */
function todoVendido(circulante: string) {
  return { circulante, tesouraria: '0' };
}

describe('NAV/token contra o supply do ledger', () => {
  it('cota realizada mantém seus tokens no denominador', () => {
    // A cota saiu do pool e virou caixa de R$ 95.000 (spread de R$ 15.000).
    // Os 80.000 tokens continuam on-chain na carteira do investidor.
    const cotas: typeof cotaAtiva[] = [];
    const realizacoes = [{ valorRealizado: '95000', spread: '15000' }];

    const unit = navPorTokenAsDecimal(
      cotas,
      realizacoes,
      todoVendido('80000'),
    );

    // 95.000 / 80.000 = 1,1875 — o spread virou yield de quem detém token.
    expect(unit.toFixed(8)).toBe('1.18750000');
  });

  it('não colapsa em runoff — era o bug que zerava o preço do resgate', () => {
    // Runoff: nenhuma cota ativa, só caixa. O denominador antigo
    // (`tokensEmitidosVivos`) ia a zero e o NAV/token com ele.
    const cotas: typeof cotaAtiva[] = [];
    const realizacoes = [{ valorRealizado: '95000', spread: '15000' }];

    expect(tokensEmitidosVivos(cotas)).toBe(0);

    const unit = navPorTokenAsDecimal(
      cotas,
      realizacoes,
      todoVendido('80000'),
    );
    expect(unit.gt(0)).toBe(true);
  });

  it('tokens em tesouraria não movem o NAV de quem já é holder', () => {
    // Pool com uma cota vendida (80.000 em circulação) e uma cota recém
    // incorporada cujos 80.000 tokens ainda estão no distributor.
    const umaVendida = navPorTokenAsDecimal([cotaAtiva], [], {
      circulante: '80000',
      tesouraria: '0',
    });

    const duasCotasUmaEmTesouraria = navPorTokenAsDecimal(
      [cotaAtiva, cotaAtiva],
      [],
      { circulante: '80000', tesouraria: '80000' },
    );

    // Incorporar não diluiu nem inflou: os R$ 80.000 de ativo novo entram no
    // numerador e os 80.000 tokens novos entram no denominador (a tesouraria é
    // posição da Plina e conta em N — não há dedução ao par).
    expect(duasCotasUmaEmTesouraria.toFixed(8)).toBe(umaVendida.toFixed(8));
    expect(umaVendida.toFixed(8)).toBe('1.00000000');
  });

  it('venda da cota em tesouraria não muda o NAV/token', () => {
    const antes = navPorTokenAsDecimal([cotaAtiva, cotaAtiva], [], {
      circulante: '80000',
      tesouraria: '80000',
    });
    const depois = navPorTokenAsDecimal([cotaAtiva, cotaAtiva], [], {
      circulante: '160000',
      tesouraria: '0',
    });
    expect(depois.toFixed(8)).toBe(antes.toFixed(8));
  });

  it('tudo na posição da Plina (circulante zero, tesouraria legada > 0): NAV = ativo ÷ supply emitido', () => {
    // Antes: devolvia 0 (a tesouraria saía do denominador). Agora a tesouraria
    // legada é posição da Plina e conta em N: 80.000 de ativo ÷ 80.000 tokens.
    const unit = navPorTokenAsDecimal([cotaAtiva], [], {
      circulante: '0',
      tesouraria: '80000',
    });
    expect(unit.toFixed(8)).toBe('1.00000000');
  });

  it('supply emitido zero devolve zero — não há passivo a precificar', () => {
    const unit = navPorTokenAsDecimal([cotaAtiva], [], {
      circulante: '0',
      tesouraria: '0',
    });
    expect(unit.isZero()).toBe(true);
  });

  it('ativo atribuível é o NAV total — sem dedução da tesouraria', () => {
    const total = navTotalDoPoolAsDecimal([cotaAtiva], []);
    expect(total.toFixed(2)).toBe('80000.00');

    const atribuivel = navAtribuivelAsDecimal([cotaAtiva], [], {
      circulante: '30000',
      tesouraria: '50000',
    });
    expect(atribuivel.toFixed(2)).toBe('80000.00');
  });

  it('mover a tesouraria legada para a posição da Plina não muda o NAV/token', () => {
    // Mesmo ativo, mesmos tokens emitidos; só muda a conta que os detém.
    const noDistributor = navPorTokenAsDecimal([cotaAtiva, cotaAtiva], [], {
      circulante: '60000',
      tesouraria: '100000',
    });
    const naPosicaoDaPlina = navPorTokenAsDecimal([cotaAtiva, cotaAtiva], [], {
      circulante: '160000',
      tesouraria: '0',
    });
    expect(naPosicaoDaPlina.toFixed(8)).toBe(noDistributor.toFixed(8));
  });

  it('resgate sem queima (token volta ao distributor) não muda o NAV/token', () => {
    // Antes a dedução da tesouraria contava duas vezes o token devolvido.
    const antes = navPorTokenAsDecimal([cotaAtiva], [], { circulante: '80000', tesouraria: '0' });
    const depois = navPorTokenAsDecimal([cotaAtiva], [], { circulante: '60000', tesouraria: '20000' });
    expect(depois.toFixed(8)).toBe(antes.toFixed(8));
  });

  it('saldo congelado continua no denominador', () => {
    // Trustline desautorizada (clawback em curso) ainda é passivo do fundo:
    // o supply do ledger inclui o saldo, então o NAV é diluído por ele — o
    // que é o comportamento correto até o clawback de fato executar.
    const comCongelado = navPorTokenAsDecimal(
      [],
      [{ valorRealizado: '95000', spread: '15000' }],
      todoVendido('80000'),
    );
    const semCongelado = navPorTokenAsDecimal(
      [],
      [{ valorRealizado: '95000', spread: '15000' }],
      todoVendido('76000'),
    );
    expect(comCongelado.lt(semCongelado)).toBe(true);
  });

  it('preserva precisão Decimal no quociente', () => {
    const unit = navPorTokenAsDecimal(
      [
        {
          valorCarta: '1000000',
          desagioAquisicao: '0',
          tokensEmitidos: '999999',
          status: StatusCota.DISPONIVEL,
        },
      ],
      [],
      todoVendido('999999'),
    );
    expect(unit.toFixed(8)).toBe('1.00000100');
  });
});
