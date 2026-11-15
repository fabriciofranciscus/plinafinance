import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

/**
 * DS5: estado "aguardando assinatura" entre o aceite e a assinatura, no acompanhamento do /vender. A cessão
 * `ENVIADA_DOCUSIGN` (DS2) é o que liga o estado; sem ela, nada muda. (O lado /admin está em
 * admin-solicitacoes.test.tsx.)
 */


describe('DS5 — /vender/acompanhar', () => {
  const data = (aguardando: boolean): AcompanharData => ({
    leadId: 'lead-1',
    cedenteNome: 'Cedente Teste',
    status: 'OFERTA_ACEITA',
    etapaAtual: 4,
    contextoDescricao: 'Texto genérico da cessão.',
    ofertaId: 'of-1',
    oferta: null,
    cessaoId: 'ces-1',
    consentTx: null,
    cessaoTx: null,
    pixTx: null,
    temCota: false,
    aguardandoAssinatura: aguardando,
  });

  it('aparece na etapa de cessão quando a cessão foi enviada para assinatura', () => {
    const html = renderToStaticMarkup(<AcompanharView data={data(true)} />);
    expect(html).toContain('data-testid="aguardando-assinatura"');
    expect(html).toContain('Aguardando assinatura');
    expect(html).toContain('foi enviado para a sua assinatura');
    expect(html).not.toContain('Texto genérico da cessão.');
    expect(html).not.toContain('Assinar com e-CPF via DocuSign');
  });

  it('sem cessão enviada: tela como antes', () => {
    const html = renderToStaticMarkup(<AcompanharView data={data(false)} />);
    expect(html).not.toContain('aguardando-assinatura');
    expect(html).toContain('Texto genérico da cessão.');
    expect(html).toContain('A assinatura eletrônica é feita pelo link de e-mail que a equipe envia nesta etapa.');
    expect(html).toContain('Verifique a caixa de spam.');
    expect(html).not.toContain('e-CPF');
    expect(html).not.toContain('em breve');
  });
});
