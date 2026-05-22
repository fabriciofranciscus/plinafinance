import { describe, it, expect } from 'vitest';
import { parseBrlAmount } from '@/lib/format/parse-brl';

describe('parseBrlAmount — F-18', () => {
  const cases: Array<[string | null | undefined, number | null]> = [
    ['1234.56', 1234.56],
    ['1234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['100', 100],
    ['0,01', 0.01],
    ['1e5', null],
    ['1E5', null],
    ['-5', null],
    ['0', null],
    ['0,00', null],
    ['  ', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['abc', null],
    ['NaN', null],
    ['Infinity', null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(parseBrlAmount(input)).toBe(expected);
    });
  }
});
