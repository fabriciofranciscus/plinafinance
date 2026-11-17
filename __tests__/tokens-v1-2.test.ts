import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Design system v1.2 (Íris 29fba09), fatia V0: o tema do app tem de carregar os mesmos valores do contrato
// (design-system/tailwind-v4.css). Nenhuma tela muda nesta fatia; as telas passam a poder usar os tokens.
const contrato = readFileSync('design-system/tailwind-v4.css', 'utf8');
const app = readFileSync('app/globals.css', 'utf8');

const props = (css: string) => {
  const m = new Map<string, string>();
  for (const [, k, v] of css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) m.set(k!, v!.replace(/\s+/g, ' ').trim());
  return m;
};
const doContrato = props(contrato);
const doApp = props(app);

const NOVOS = [
  '--radius-card', '--radius-panel', '--radius-full', '--radius-none',
  '--shadow-raised', '--shadow-overlay', '--shadow-none',
  '--workspace-max', '--form-max', '--target-min', '--spacing-gutter-ui', '--spacing-compact',
  '--text-page-title', '--text-section-title', '--text-body-ui', '--text-label-ui', '--text-value-primary',
  '--icon-inline', '--icon-default', '--icon-navigation',
  '--duration-instant', '--duration-fast', '--duration-base', '--duration-slow', '--duration-reveal',
  '--ease-terminal',
];
const SUB = ['line-height', 'font-weight', 'letter-spacing'];

describe('tokens da v1.2 no tema do app', () => {
  for (const k of NOVOS) {
    it(`${k} existe no app com o valor do contrato`, () => {
      expect(doContrato.has(k), `${k} sumiu do contrato`).toBe(true);
      expect(doApp.get(k), k).toBe(doContrato.get(k));
    });
  }
  for (const papel of ['page-title', 'section-title', 'body-ui', 'label-ui', 'value-primary']) {
    for (const s of SUB) {
      const k = `--text-${papel}--${s}`;
      it(`${k} igual ao contrato`, () => expect(doApp.get(k), k).toBe(doContrato.get(k)));
    }
  }

  it('o raio de painel é 16 px, o de cartão 12 px e a sombra de repouso não existe', () => {
    expect(doApp.get('--radius-panel')).toBe('16px');
    expect(doApp.get('--radius-card')).toBe('12px');
    expect(doApp.get('--shadow-none')).toBe('none');
  });

  it('a sombra ciano da v1.1 não entra no app', () => {
    expect(app).not.toMatch(/rgba\(14,\s*167,\s*199,\s*0\.2\)/);
  });

  it('modo de movimento reduzido: o produto não anima e o reveal nasce visível', () => {
    expect(app).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.plina-product/);
    expect(app).toMatch(/\.plina-reveal\s*\{\s*opacity:\s*1 !important;\s*transform:\s*none !important;/);
  });
});
