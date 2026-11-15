import { describe, expect, it } from 'vitest';
import { fmtPrazo } from '@/lib/format/prazo';
import { readFileSync } from 'node:fs';

describe('fmtPrazo (A-21)', () => {
  it('0 é prazo válido (quitada), não "sem informação"', () => {
    expect(fmtPrazo(0)).toBe('0m');
    expect(fmtPrazo(0, 'longa')).toBe('0 meses');
  });
  it('null/undefined = "—"; valores normais', () => {
    expect(fmtPrazo(null)).toBe('—');
    expect(fmtPrazo(undefined, 'longa')).toBe('—');
    expect(fmtPrazo(18)).toBe('18m');
    expect(fmtPrazo(18, 'longa')).toBe('18 meses');
  });
  it('/cotas não renderiza o prazo com `&&` (imprimiria o 0)', () => {
    const src = readFileSync('app/cotas/page.tsx', 'utf8');
    expect(src).not.toMatch(/\{prazoRestanteMeses && \(/);
    expect(src).toContain('prazoRestanteMeses != null &&');
  });
});
