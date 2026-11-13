import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { navPorTokenAsDecimal, navTotalDoPoolAsDecimal } from '@/lib/services/pool';
import {
  montarNumerador,
  recalcularNav,
  type ArquivoSnapshotNav,
} from '@/lib/services/snapshot-nav-arquivo';

const D = (v: string) => new Prisma.Decimal(v);
const cotas = [
  { id: 'c2', status: 'RESERVADA', valorCarta: '120000.00', desagioAquisicao: '0.2500', tokensEmitidos: '90000' },
  { id: 'c1', status: 'DISPONIVEL', valorCarta: '80000.50', desagioAquisicao: '0.2000', tokensEmitidos: '64000.4' },
];
const caixa = { movimentos: 3, porTipo: { SUBSCRICAO: '1000.5', RESGATE_PAGO: '-200.25', REALIZACAO: '0' } };

function arquivo(totalEmitido: string, saldoDistributor: string): Pick<ArquivoSnapshotNav, 'numerador' | 'circulante' | 'nav'> {
  const f = (v: string) => D(v).toFixed(7);
  return {
    numerador: montarNumerador(cotas, caixa),
    circulante: {
      PLINARF: {
        issuer: 'G',
        distributor: 'GD',
        totalEmitido: f(totalEmitido),
        saldoIssuer: f('0'),
        saldoDistributor: f(saldoDistributor),
        circulante: f(D(totalEmitido).minus(saldoDistributor).toString()),
        trustlinesAutorizadas: { contas: 1, soma: f('0') },
      },
    },
    nav: { classe: 'PLINARF', regra: 'NAV_DO_LEDGER', denominador: '', porToken: '', porTokenSobreCirculante: null, notaDenominador: '' },
  };
}

describe('montarNumerador / recalcularNav', () => {
  it('numerador do arquivo = navTotalDoPool do produto (cotas marcadas + caixa do razão), itens ordenados por id', () => {
    const n = montarNumerador(cotas, caixa);
    expect(n.cotasAtivas.itens.map((i) => i.cotaId)).toEqual(['c1', 'c2']);
    expect(n.cotasAtivas.itens[0].valorMarcado).toBe('64000.40');
    const produto = navTotalDoPoolAsDecimal(
      cotas.map((c) => ({ ...c, status: c.status as never })),
      [{ valorRealizado: D('1000.5').plus('-200.25') }],
    );
    expect(D(n.total).eq(produto)).toBe(true);
    expect(n.caixaRealizado).toEqual({
      total: '800.2500000',
      movimentos: 3,
      porTipo: { REALIZACAO: '0.0000000', RESGATE_PAGO: '-200.2500000', SUBSCRICAO: '1000.5000000' },
    });
  });

  it('NAV/token do revisor = navPorTokenAsDecimal do produto (distributor sem saldo: os dois denominadores coincidem)', () => {
    const a = arquivo('150000', '0');
    const r = recalcularNav(a);
    const produto = navPorTokenAsDecimal(
      cotas.map((c) => ({ ...c, status: c.status as never })),
      [{ valorRealizado: D('800.25') }],
      { circulante: D('150000'), tesouraria: D('0') },
    );
    expect(r.porToken.eq(produto)).toBe(true);
    expect(r.regra).toBe('NAV_DO_LEDGER');
    expect(r.porTokenSobreCirculante?.eq(r.porToken)).toBe(true);
  });

  it('com saldo no distributor: denominador do produto = emitido; sobre o circulante do SOW é outro número, e os dois aparecem', () => {
    const r = recalcularNav(arquivo('150000', '30000'));
    expect(r.circulante.toString()).toBe('120000');
    expect(r.denominador.toString()).toBe('150000');
    expect(r.porToken.eq(r.numerador.div(150000).toDecimalPlaces(8))).toBe(true);
    expect(r.porTokenSobreCirculante?.eq(r.numerador.div(120000).toDecimalPlaces(8))).toBe(true);
    expect(r.porToken.eq(r.porTokenSobreCirculante!)).toBe(false);
  });

  it('sem supply emitido: NAV_INICIAL R$ 1,00 e nada sobre o circulante', () => {
    const r = recalcularNav(arquivo('0', '0'));
    expect(r.regra).toBe('NAV_INICIAL');
    expect(r.porToken.toString()).toBe('1');
    expect(r.porTokenSobreCirculante).toBeNull();
  });

  it('itens levam hashValidacao e emissaoTxHash; valorCarta/deságio só quando pedido (mainnet os omite); regra de marcação rotulada', () => {
    const c = [{ ...cotas[0], hashValidacao: 'h'.repeat(64), emissaoTxHash: 't'.repeat(64) }];
    const teste = montarNumerador(c, caixa);
    expect(teste.regraMarcacao).toBe('CUSTO_DE_AQUISICAO');
    expect(teste.cotasAtivas.itens[0]).toMatchObject({ hashValidacao: 'h'.repeat(64), emissaoTxHash: 't'.repeat(64), valorCarta: '120000.00', desagioAquisicao: '0.2500' });
    const main = montarNumerador(c, caixa, { incluirPrecoDaCarta: false });
    expect(main.cotasAtivas.itens[0]).not.toHaveProperty('valorCarta');
    expect(main.cotasAtivas.itens[0]).not.toHaveProperty('desagioAquisicao');
    expect(main.cotasAtivas.itens[0].valorMarcado).toBe(teste.cotasAtivas.itens[0].valorMarcado);
    expect(main.total).toBe(teste.total); // a conta do revisor não depende do preço da carta
    expect(montarNumerador([{ ...cotas[0] }], caixa).cotasAtivas.itens[0]).toMatchObject({ hashValidacao: null, emissaoTxHash: null });
  });

  it('não confia em total pré-somado: soma de novo a partir dos itens e do caixa por tipo', () => {
    const a = arquivo('150000', '0');
    a.numerador.total = '999999.0000000';
    expect(recalcularNav(a).numerador.eq(D('64000.40').plus('90000.00').plus('800.25'))).toBe(true);
  });
});
