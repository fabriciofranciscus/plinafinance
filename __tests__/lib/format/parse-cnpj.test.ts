import { describe, it, expect } from 'vitest';
import { parseCnpj } from '@/lib/format/parse-cnpj';

describe('parseCnpj', () => {
  const cases: Array<[unknown, string | null]> = [
    ['11.222.333/0001-81', '11222333000181'],
    ['11222333000181', '11222333000181'],
    ['04.252.011/0001-10', '04252011000110'],
    ['00.000.000/0000-00', null],
    ['11111111111111', null],
    ['11222333000100', null], // DV incorreto
    ['', null],
    ['abc', null],
    [null, null],
    [undefined, null],
    [11222333000181, null], // não-string
    ['1122233300018', null], // 13 dígitos
    ['112223330001811', null], // 15 dígitos
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(parseCnpj(input)).toBe(expected);
    });
  }
});
