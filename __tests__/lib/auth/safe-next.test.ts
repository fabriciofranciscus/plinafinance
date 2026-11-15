import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/safe-next';

const O = 'https://plina.finance';

describe('safeNext (U1: open redirect no /entrar)', () => {
  it.each([
    ['/\\evil.com'],
    ['/%5Cevil.com'],
    ['/%5cevil.com'],
    ['//evil.com'],
    ['///evil.com'],
    ['https://evil.com'],
    ['http://evil.com/pool'],
    ['evil.com'],
    ['javascript:alert(1)'],
    ['/\t/x'],
    ['/\n/x'],
    ['/\r/x'],
    ['/\\\\x'],
    ['/\\\tx'],
    ['/%2F%5Cx'.replace('%2F', '')],
    ['/\tevil.com'],
    ['/%09/evil.com'],
    ['/\nevil.com'],
    ['/%0Aevil.com'],
    ['/%'],
    ['/%2f%2fevil.com/'.replace('%2f%2f', '%5C')],
    [''],
    [null],
    [undefined],
  ])('recusa %j', (raw) => {
    expect(safeNext(raw as string | null | undefined, O)).toBeNull();
  });

  it.each([
    ['/pool', '/pool'],
    ['/pool?x=1#a', '/pool?x=1#a'],
    ['/vender/minhas', '/vender/minhas'],
    ['/vender/minhas?a=1&b=%C3%A9', '/vender/minhas?a=1&b=%C3%A9'],
    ['/vender/acompanhar/abc?aviso=reaproveitada', '/vender/acompanhar/abc?aviso=reaproveitada'],
    ['/historico?exemplo=1', '/historico?exemplo=1'],
    ['/', '/'],
  ])('aceita caminho da mesma origem %j', (raw, esperado) => {
    expect(safeNext(raw, O)).toBe(esperado);
  });

  it('devolve pathname + search + hash resolvidos, nunca a string crua (ex.: ponto-ponto)', () => {
    expect(safeNext('/a/../pool?y=2', O)).toBe('/pool?y=2');
  });

  it('o resultado nunca sai da origem', () => {
    for (const raw of ['/%2F%2Fevil.com', '/pool/%2e%2e/%2e%2e/x']) {
      const r = safeNext(raw, O);
      if (r !== null) expect(new URL(r, O).origin).toBe(O);
    }
  });
});
