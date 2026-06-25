import { describe, it, expect } from 'vitest';
import {
  assetCodeForClasse,
  classeOrDefault,
  classeFromAssetCode,
} from '@/lib/stellar/classes';

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

  it('classeFromAssetCode: reverso de assetCodeForClasse', () => {
    expect(classeFromAssetCode('PLINARF')).toBe('SENIOR');
    expect(classeFromAssetCode('PLINARFB')).toBe('SUBORDINADA');
    // Qualquer code desconhecido cai em SENIOR (preserva single-asset legado).
    expect(classeFromAssetCode('OUTRO')).toBe('SENIOR');
    // Round-trip nas duas classes.
    expect(classeFromAssetCode(assetCodeForClasse('SENIOR'))).toBe('SENIOR');
    expect(classeFromAssetCode(assetCodeForClasse('SUBORDINADA'))).toBe(
      'SUBORDINADA',
    );
  });
});
