import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A2 (Norma/Consuelo; Thais: no D30 só cotas quitadas): o /comprar não chama a diferença
 * para o valor de face de "economia" nem diz que o comprador "poupa" (omite as parcelas
 * restantes; risco de publicidade enganosa). Guarda só os literais visíveis destes 3 arquivos.
 */
const ARQUIVOS = [
  'app/comprar/_components/screens/buscar.tsx',
  'app/comprar/_components/screens/confirmacao.tsx',
  'app/comprar/[reservaId]/comprovante/page.tsx',
];

/** Texto visível aproximado: strings e JSX, sem comentários nem identificadores. */
function literais(src: string): string {
  const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const strings = [...semComentarios.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
  const jsx = [...semComentarios.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...strings, ...jsx].join('\n');
}

describe('/comprar sem "poupa" nem "economia" (A2)', () => {
  for (const f of ARQUIVOS) {
    it(f, () => {
      const t = literais(readFileSync(f, 'utf8'));
      expect(t).not.toMatch(/\bpoupa\b|\beconomia\b|\beconomize\b/i);
    });
  }

  it('o cartão e a confirmação trazem a nota de cotas quitadas', () => {
    for (const f of ARQUIVOS.slice(0, 2)) {
      expect(readFileSync(f, 'utf8')).toContain('Nesta fase, só são aceitas cotas quitadas (sem parcelas restantes).');
    }
  });
});
