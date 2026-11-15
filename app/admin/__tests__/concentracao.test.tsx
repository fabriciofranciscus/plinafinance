import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Concentracao } from '../concentracao';

const itens = [
  { administradora: 'Administradora Exemplo S.A.', valor: 'R$ 1.234.567,89', participacao: '62,5%', alerta: true },
  { administradora: 'Caixa', valor: 'R$ 205.000', participacao: '18,0%', alerta: false },
];

describe('Concentração por administradora (A-23, Íris)', () => {
  const html = renderToStaticMarkup(<Concentracao itens={itens} />);

  it('ordem do DOM: nome → valor → participação → estado; valores integrais e estado em TEXTO', () => {
    const ordem = ['Administradora Exemplo S.A.', 'R$ 1.234.567,89', '62,5%', 'concentrado'].map((t) => html.indexOf(t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain('>ok<');
    expect(html).toContain('Concentração por administradora · alerta &gt; 40%');
  });

  it('abaixo de md uma coluna fluida (minmax(0,1fr)) e rótulos "Valor:"/"Participação:"; de md em diante 4 colunas', () => {
    expect(html).toContain('grid-cols-[minmax(0,1fr)]');
    expect(html).toContain('md:grid-cols-[minmax(0,1fr)_120px_80px_100px]');
    expect(html).toContain('Valor: ');
    expect(html).toContain('Participação: ');
    expect(html).not.toMatch(/grid-cols-\[1fr_120px_80px_100px\]/); // a grade fixa que estourava 390 px
  });

  it('nome pode quebrar (min-w-0 + overflow-wrap:anywhere); estado sem nowrap, largura nem altura fixas', () => {
    expect(html).toContain('min-w-0');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).not.toMatch(/whitespace-nowrap|truncate|text-ellipsis/);
  });

  it('lista vazia: não renderiza nada (comportamento anterior)', () => {
    expect(renderToStaticMarkup(<Concentracao itens={[]} />)).toBe('');
  });
});
