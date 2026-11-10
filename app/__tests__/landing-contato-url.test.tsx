// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactForm } from '@/components/landing/ContactForm';
import { ptBR } from '@/lib/i18n/dictionaries/pt-BR';

/**
 * F-LD3-1 (Argus) + decisão da Thais: o formulário da landing NUNCA pode
 * pôr nome, e-mail ou mensagem na URL da página (logs, histórico, analytics).
 */
const dict = ptBR.landingV2.contato;
const NOME = 'Maria Silva';
const EMAIL = 'maria.silva@exemplo-privado.com.br';
const MENSAGEM = 'Mensagem confidencial sobre a cota 12345';

function preencher() {
  fireEvent.change(screen.getByLabelText(dict.form.nome), { target: { value: NOME } });
  fireEvent.change(screen.getByLabelText(dict.form.email), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText(dict.form.interesse), { target: { value: 'cota' } });
  fireEvent.change(screen.getByLabelText(dict.form.mensagem), { target: { value: MENSAGEM } });
}

describe('landing: formulário de contato não vaza dados para a URL', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom não tem matchMedia (os navegadores têm)
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;
    history.replaceState(null, '', '/');
  });
  afterEach(cleanup);

  it('sem JavaScript (HTML do servidor): method=post e botão desabilitado', () => {
    const html = renderToString(<ContactForm dict={dict} />);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).not.toMatch(/<form[^>]*method="get"/i);
  });

  it('depois de montar, enviar não navega e location.href não contém os dados digitados', () => {
    render(<ContactForm dict={dict} />);
    const botao = screen.getByRole('button', { name: new RegExp(dict.form.preparar) });
    expect((botao as HTMLButtonElement).disabled).toBe(false);
    const hrefAntes = location.href;
    preencher();

    const form = document.getElementById('contact-form') as HTMLFormElement;
    // fireEvent devolve false quando o handler chamou preventDefault: o navegador não envia o form
    const naoPrevenido = fireEvent.submit(form);
    expect(naoPrevenido).toBe(false);

    expect(location.href).toBe(hrefAntes);
    for (const segredo of [NOME, EMAIL, MENSAGEM, encodeURIComponent(EMAIL), encodeURIComponent(NOME), '@']) {
      expect(location.href).not.toContain(segredo);
    }
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
  });

  it('o rascunho aparece na página (não na URL) e o mailto fica só no link do usuário', () => {
    render(<ContactForm dict={dict} />);
    preencher();
    fireEvent.submit(document.getElementById('contact-form') as HTMLFormElement);
    expect(screen.getByText(/Meu nome é Maria Silva\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: new RegExp(dict.rascunho.abrir) }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toMatch(/^mailto:contato@plina\.finance\?subject=/);
    expect(location.href).not.toContain(EMAIL);
  });

  it('Enter num campo também passa pelo handler (nada é enviado ao servidor)', () => {
    render(<ContactForm dict={dict} />);
    preencher();
    const campo = screen.getByLabelText(dict.form.email);
    // keyDown Enter dispara submit implícito no navegador; aqui simulamos o submit resultante
    fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' });
    const prevenido = !fireEvent.submit(document.getElementById('contact-form') as HTMLFormElement);
    expect(prevenido).toBe(true);
    expect(location.href).not.toContain(EMAIL);
  });
});
