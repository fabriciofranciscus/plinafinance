import { describe, expect, it } from 'vitest';
import { normalizarQuantidade, quantidadeMaxima, quantidadeValida } from '../resgate-amount';

describe('quantidade do resgate (até 7 casas)', () => {
  it('aceita inteiro e decimal de 1 a 7 casas; vírgula vira ponto', () => {
    for (const v of ['1', '100', '0.5', '12.3456789', '1,25']) expect(quantidadeValida(v, 1e9)).toBe(true);
    expect(normalizarQuantidade(' 1,25 ')).toBe('1.25');
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
