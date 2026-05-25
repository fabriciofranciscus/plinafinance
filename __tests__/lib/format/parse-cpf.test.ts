import { describe, it, expect } from 'vitest';
import { parseCpf } from '@/lib/format/parse-cpf';

describe('parseCpf — F-12', () => {
  const cases: Array<[unknown, string | null]> = [
    ['529.982.247-25', '52998224725'],
    ['52998224725', '52998224725'],
    ['111.444.777-35', '11144477735'],
    ['000.000.000-00', null],
    ['11111111111', null],
    ['12345678900', null],
    ['529.982.247-26', null],
    ['', null],
    ['abc', null],
    [null, null],
    [undefined, null],
    [12345678900, null],
    ['529.982.247-2', null],
    ['529.982.247-255', null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(parseCpf(input)).toBe(expected);
    });
  }
});
