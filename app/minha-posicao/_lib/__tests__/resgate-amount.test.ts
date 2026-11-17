import { describe, expect, it } from 'vitest';
import { normalizarQuantidade, quantidadeMaxima, quantidadeValida } from '../resgate-amount';

describe('quantidade do resgate (até 7 casas)', () => {
  it('aceita inteiro e decimal de 1 a 7 casas; vírgula vira ponto', () => {
    for (const v of ['1', '100', '0.5', '12.3456789', '1,25']) expect(quantidadeValida(v, 1e9)).toBe(true);
    expect(normalizarQuantidade(' 1,25 ')).toBe('1.25');
  });

  it('separador de milhar (I2): "1.234,5" e "1,234.5" viram 1234.5; vários separadores iguais são milhar', () => {
    expect(normalizarQuantidade('1.234,5')).toBe('1234.5');
    expect(normalizarQuantidade('1.234.567,89')).toBe('1234567.89');
    expect(normalizarQuantidade('1,234.5')).toBe('1234.5');
    expect(normalizarQuantidade('1.234.567')).toBe('1234567');
    expect(normalizarQuantidade('1,234,567')).toBe('1234567');
    for (const v of ['1.234,5', '1,234.5', '1.234.567,8901234']) expect(quantidadeValida(v, 1e9), v).toBe(true);
  });

  it('o que não tem milhar continua como era: um só ponto é decimal ("1.234" = 1,234), uma só vírgula vira ponto', () => {
    expect(normalizarQuantidade('1.234')).toBe('1.234');
    expect(normalizarQuantidade('139.6')).toBe('139.6');
    expect(normalizarQuantidade('139,6')).toBe('139.6');
    expect(normalizarQuantidade('12')).toBe('12');
  });

  it('o milhar não afrouxa o resto: 8 casas e notação científica seguem recusadas', () => {
    for (const v of ['1.234,12345678', '1.234e3', '1.234,', ',5.', '1..2']) expect(quantidadeValida(v, 1e15), v).toBe(false);
  });

  it('recusa vazio, zero, negativo, 8 casas, texto, notação científica e mais de 12 dígitos inteiros', () => {
    for (const v of ['', '0', '0.0000000', '-1', '1.12345678', 'abc', '1e3', '1.', '.5', '1234567890123']) {
      expect(quantidadeValida(v, 1e15)).toBe(false);
    }
  });

  it('recusa acima do saldo exibido', () => {
    expect(quantidadeValida('10.5', 10.4)).toBe(false);
    expect(quantidadeValida('10.4', 10.4)).toBe(true);
  });

  it('Máx trunca em 7 casas e nunca passa do saldo; sem zeros à direita', () => {
    expect(quantidadeMaxima(387400)).toBe('387400');
    expect(quantidadeMaxima(12.34567899)).toBe('12.3456789');
    expect(Number(quantidadeMaxima(0.1 + 0.2))).toBeLessThanOrEqual(0.1 + 0.2);
    expect(quantidadeMaxima(0)).toBe('');
    expect(quantidadeMaxima(NaN)).toBe('');
  });
});
