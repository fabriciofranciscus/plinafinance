import { describe, it, expect } from 'vitest';
import { stripInternalKeys } from '@/lib/audit/strip-internal';

describe('stripInternalKeys — N-17', () => {
  it('remove top-level _type/_at/_ref', () => {
    const r = stripInternalKeys({
      _type: 'lead_capturado',
      _at: '2026-05-22T00:00:00Z',
      _ref: 'lead_1',
      nome: 'X',
      email: 'x@y.z',
    });
    expect(r).toEqual({ nome: 'X', email: 'x@y.z' });
  });

  it('passa null intacto', () => {
    expect(stripInternalKeys(null)).toBe(null);
  });

  it('passa primitivos intactos', () => {
    expect(stripInternalKeys('hello' as never)).toBe('hello');
    expect(stripInternalKeys(42 as never)).toBe(42);
  });

  it('passa array intacto', () => {
    const arr = [{ _at: 'x', y: 1 }];
    expect(stripInternalKeys(arr as never)).toBe(arr);
  });

  it('preserva chaves aninhadas com _ (escopo é só top-level)', () => {
    const r = stripInternalKeys({
      _type: 'evento',
      data: { _internal: 'keep' },
    });
    expect(r).toEqual({ data: { _internal: 'keep' } });
  });

  it('objeto sem chaves _ → noop semântico', () => {
    const r = stripInternalKeys({ a: 1, b: 2 });
    expect(r).toEqual({ a: 1, b: 2 });
  });
});
