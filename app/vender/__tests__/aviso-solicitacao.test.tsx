import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AvisoSolicitacao from '@/components/vender/AvisoSolicitacao';

describe('AvisoSolicitacao (A-11)', () => {
  it('com ?aviso=reaproveitada mostra o texto do Bento', () => {
    const html = renderToStaticMarkup(<AvisoSolicitacao aviso="reaproveitada" />);
    expect(html).toContain('Você já tem uma solicitação aberta; abrimos a mesma.');
    expect(html).toContain('role="status"');
  });
  it('sem o parâmetro ou com outro valor: nada', () => {
    expect(renderToStaticMarkup(<AvisoSolicitacao aviso={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<AvisoSolicitacao aviso="qualquer" />)).toBe('');
  });
});
