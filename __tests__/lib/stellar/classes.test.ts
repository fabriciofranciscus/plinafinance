import { describe, it, expect } from 'vitest';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';

describe('lib/stellar/classes', () => {
  it('SENIOR → PLINARF (asset code legacy)', () => {
    expect(assetCodeForClasse('SENIOR')).toBe('PLINARF');
  });

  it('SUBORDINADA → PLINARFB', () => {
    expect(assetCodeForClasse('SUBORDINADA')).toBe('PLINARFB');
  });

  it('null/undefined defaulta para PLINARF (preserva fluxo single-asset legado)', () => {
    expect(assetCodeForClasse(null)).toBe('PLINARF');
    expect(assetCodeForClasse(undefined)).toBe('PLINARF');
  });

  it('classeOrDefault: null/undefined → SENIOR', () => {
    expect(classeOrDefault(null)).toBe('SENIOR');
    expect(classeOrDefault(undefined)).toBe('SENIOR');
    expect(classeOrDefault('SUBORDINADA')).toBe('SUBORDINADA');
    expect(classeOrDefault('SENIOR')).toBe('SENIOR');
  });
});
