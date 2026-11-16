import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// P0 de compliance (Norma/Atlas, 15/11 23:56): o pool não é "público"; o texto da Consuelo (#102) é "pool de demonstração".
const fontes: Array<[string, string]> = [
  ['app/minha-posicao/page.tsx', 'cta="Pool de demonstração"'],
  ['components/AppFooter.tsx', 'Pool de demonstração · NAV'],
];

describe.each(fontes)('%s', (arquivo, esperado) => {
  const src = readFileSync(arquivo, 'utf8');
  it('diz "pool de demonstração" e não "pool público"', () => {
    expect(src).toContain(esperado);
    expect(src).not.toMatch(/pool p[úu]blico|pool tokenizado p[úu]blico/i);
  });
});
