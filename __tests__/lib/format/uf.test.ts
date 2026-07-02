import { describe, it, expect } from 'vitest';
import { isUfValida } from '@/lib/format/uf';

describe('isUfValida', () => {
  it('aceita UF válida maiúscula', () => {
    expect(isUfValida('SP')).toBe(true);
    expect(isUfValida('DF')).toBe(true);
    expect(isUfValida('AC')).toBe(true);
  });

  it('aceita UF válida minúscula (normaliza)', () => {
    expect(isUfValida('sp')).toBe(true);
  });

  it('aceita com espaços em volta', () => {
    expect(isUfValida(' RJ ')).toBe(true);
  });

  it('rejeita sigla inexistente', () => {
    expect(isUfValida('SPP')).toBe(false);
    expect(isUfValida('XX')).toBe(false);
  });

  it('rejeita vazio', () => {
    expect(isUfValida('')).toBe(false);
  });
});
