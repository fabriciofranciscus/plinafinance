import { describe, expect, it } from 'vitest';
import { JsonCanonicoError, bytesCanonicos, canonicalizar } from '@/lib/services/json-canonico';

describe('json canônico (RFC 8785)', () => {
  it('ordena as chaves por unidade de código UTF-16 (exemplo da RFC §3.2.3)', () => {
    const entrada = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      '\n': 'Newline',
      '1': 'One',
      '\u0080': 'Control',
      '😀': 'Emoji',
      'ö': 'Latin Small Letter O With Diaeresis',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '</script>': 'Browser Challenge',
    };
    // Compara o TEXTO: Object.keys reordenaria a chave "1" (inteira) para a frente.
    const ordem = ['Newline', 'Carriage Return', 'One', 'Browser Challenge', 'Control',
      'Latin Small Letter O With Diaeresis', 'Euro Sign', 'Emoji', 'Hebrew Letter Dalet With Dagesh'];
    const valores = [...canonicalizar(entrada).matchAll(/:("[^"]*")/g)].map((m) => JSON.parse(m[1]));
    expect(valores).toEqual(ordem);
  });

  it('sem espaço, aninhado, arrays na ordem dada', () => {
    expect(canonicalizar({ b: [3, { z: null, a: true }], a: 'x' })).toBe('{"a":"x","b":[3,{"a":true,"z":null}]}');
  });

  it('a mesma estrutura com chaves em outra ordem dá os mesmos bytes', () => {
    expect(bytesCanonicos({ a: 1, b: { c: 2, d: 3 } }).equals(bytesCanonicos({ b: { d: 3, c: 2 }, a: 1 }))).toBe(true);
  });

  it('UTF-8 sem escape desnecessário', () => {
    expect(bytesCanonicos({ k: 'ação' }).toString('utf8')).toBe('{"k":"ação"}');
  });

  it.each([
    ['float', { v: 1.5 }],
    ['NaN', { v: Number.NaN }],
    ['Infinity', { v: Infinity }],
    ['undefined', { v: undefined }],
    ['bigint', { v: BigInt(1) }],
    ['Date', { v: new Date(0) }],
    ['função', { v: () => 1 }],
  ])('recusa %s (nada é arredondado em silêncio)', (_n, v) => {
    expect(() => canonicalizar(v)).toThrow(JsonCanonicoError);
  });
});
