import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NotFound from '../not-found';

// U2 A-18 (Vera): 404 própria em PT, com caminho de volta.
describe('A-18: 404 própria em PT', () => {
  const html = renderToStaticMarkup(<NotFound />);
  it('h1 em PT e nada em inglês do padrão do Next', () => {
    expect(html).toMatch(/<h1[^>]*>Página não encontrada<\/h1>/);
    expect(html).toContain('O endereço que você abriu não existe ou foi movido.');
    expect(html).not.toContain('This page could not be found');
  });
  it('link de volta ao início', () => {
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Voltar ao início<\/a>/);
  });
});
