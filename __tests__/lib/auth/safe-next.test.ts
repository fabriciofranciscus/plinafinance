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
    ['/.//evil.com'],
    ['/..//evil.com'],
    ['/a/../..//evil.com'],
    ['/%2e//evil.com'],
    ['/a/..//evil.com'],
    ['/%2E//evil.com'],
    ['/%2e%2e//evil.com'],
    ['/./\\evil.com'],
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

  it('o destino devolvido nunca começa com // (protocol-relative) nem tem barra invertida', () => {
    for (const raw of ['/.//evil.com', '/a/..//evil.com', '/%2E//evil.com', '/%2e%2e//evil.com', '/pool', '/pool?u=//x#//y']) {
      const r = safeNext(raw, O);
      if (r !== null) {
        expect(r.startsWith('//')).toBe(false);
        expect(r.includes('\\')).toBe(false);
      }
    }
    // "//" na query ou no hash é inofensivo e continua aceito
    expect(safeNext('/pool?u=//x#//y', O)).toBe('/pool?u=//x#//y');
  });

  it('o resultado nunca sai da origem', () => {
    for (const raw of ['/%2F%2Fevil.com', '/pool/%2e%2e/%2e%2e/x']) {
      const r = safeNext(raw, O);
      if (r !== null) expect(new URL(r, O).origin).toBe(O);
    }
  });

  it('PROPRIEDADE: para qualquer entrada, o que for aceito fica na mesma origem e não começa com //', () => {
    const pedacos = ['/', '.', '..', '%2e', '%2E', '%2f', '%5c', '\\', '//', 'a', 'pool', '?', '#', 'x=1', 'evil.com', '\t', '%09', ':', '@'];
    // determinístico: gera combinações de 1 a 4 pedaços (~130 mil entradas; depth 5 estourava o tempo na suíte inteira)
    let n = 0;
    const gera = (prefixo: string, nivel: number) => {
      if (nivel > 0) {
        const r = safeNext(prefixo, O);
        if (r !== null) {
          n++;
          expect(new URL(r, O).origin).toBe(O);
          expect(r.startsWith('//')).toBe(false);
          expect(r.includes('\\')).toBe(false);
        }
      }
      if (nivel === 4) return;
      for (const p of pedacos) gera(prefixo + p, nivel + 1);
    };
    for (const p of pedacos) gera('/' + p, 1);
    expect(n).toBeGreaterThan(100); // a propriedade foi de fato exercitada com entradas aceitas
  });
});
