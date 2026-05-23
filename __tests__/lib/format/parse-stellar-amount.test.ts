import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  parseStellarAmount,
  toStellarAmountString,
} from '@/lib/format/parse-stellar-amount';

describe('parseStellarAmount — C-02', () => {
  it('inteiro válido', () => {
    expect(parseStellarAmount('1').toFixed(7)).toBe('1.0000000');
  });

  it('7 casas exatas', () => {
    expect(parseStellarAmount('1.1234567').toFixed(7)).toBe('1.1234567');
  });

  it('menos de 7 casas — preserva precisão sem padding silencioso na entrada', () => {
    const dec = parseStellarAmount('1.12');
    expect(dec.toFixed()).toBe('1.12');
    expect(dec.toFixed(7)).toBe('1.1200000');
  });

  it('Decimal de entrada', () => {
    const input = new Prisma.Decimal('123.4567');
    expect(parseStellarAmount(input).toFixed(7)).toBe('123.4567000');
  });

  it('rejeita >7 casas decimais', () => {
    expect(() => parseStellarAmount('1.12345678')).toThrow(/inválido/);
  });

  it('rejeita scientific notation', () => {
    expect(() => parseStellarAmount('1e10')).toThrow(/inválido/);
  });

  it('rejeita negativo', () => {
    expect(() => parseStellarAmount('-1')).toThrow(/inválido/);
  });

  it('rejeita zero', () => {
    expect(() => parseStellarAmount('0')).toThrow(/positivo/);
  });

  it('rejeita NaN/non-numeric', () => {
    expect(() => parseStellarAmount('abc')).toThrow(/inválido/);
  });

  it('rejeita vírgula como separador', () => {
    expect(() => parseStellarAmount('1,5')).toThrow(/inválido/);
  });

  it('rejeita tipo não-string/non-Decimal', () => {
    expect(() => parseStellarAmount(123)).toThrow(/inválido/);
    expect(() => parseStellarAmount(null)).toThrow(/inválido/);
    expect(() => parseStellarAmount(undefined)).toThrow(/inválido/);
  });

  it('preserva stroops em valores grandes (sem IEEE-754 drift)', () => {
    // Number(10000000.5555555).toFixed(7) erra; Decimal preserva.
    const big = '10000000.5555555';
    expect(parseStellarAmount(big).toFixed(7)).toBe('10000000.5555555');
  });

  it('toStellarAmountString — atalho', () => {
    expect(toStellarAmountString('1.5')).toBe('1.5000000');
  });
});
