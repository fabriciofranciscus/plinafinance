import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SemCotaEscolhida } from '../sem-cota';

// U2 A-26 (Vera): /comprar/reservar sem cota com h1, texto sem termo interno e link.
describe('A-26: /comprar/reservar sem cota escolhida', () => {
  const html = renderToStaticMarkup(<SemCotaEscolhida />);
  it('tem h1, texto em PT e não mostra "cotaId"', () => {
    expect(html).toMatch(/<h1[^>]*>Escolha uma cota primeiro<\/h1>/);
    expect(html).toContain('Você chegou aqui sem escolher uma cota. Veja as cotas listadas e selecione uma para continuar.');
    expect(html).not.toMatch(/cotaId/i);
  });
  it('link para /cotas', () => {
    expect(html).toMatch(/<a[^>]*href="\/cotas"[^>]*>Ver cotas<\/a>/);
  });
  it('a página usa o componente e não o texto antigo', () => {
    const src = readFileSync('app/comprar/reservar/page.tsx', 'utf8');
    expect(src).toContain('<SemCotaEscolhida');
    expect(src).not.toContain('Sem cotaId');
  });
});
