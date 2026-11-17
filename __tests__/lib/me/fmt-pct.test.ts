import { describe, expect, it } from 'vitest';
import { fmtPct } from '@/lib/me/formato';

// U2 A-08 (formato): "Posição no pool 0.03 %" saía com ponto; pt-BR usa vírgula.
describe('fmtPct (pt-BR)', () => {
  it('2 casas, vírgula decimal e o símbolo colado', () => {
    expect(fmtPct(0.03)).toBe('0,03%');
    expect(fmtPct(12.3456)).toBe('12,35%');
    expect(fmtPct(0)).toBe('0,00%');
  });
  it('milhar com ponto e valor inválido vira traço', () => {
    expect(fmtPct(1234.5)).toBe('1.234,50%');
    expect(fmtPct(Number.NaN)).toBe('—');
  });
});
