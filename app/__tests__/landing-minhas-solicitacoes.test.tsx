// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/set-locale', () => ({ setLocale: vi.fn() }));

import { TopBar } from '@/components/landing/TopBar';
import { ptBR } from '@/lib/i18n/dictionaries/pt-BR';
import { en } from '@/lib/i18n/dictionaries/en';

beforeAll(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe('landing: acesso secundário a "Minhas solicitações" (A-09, Íris)', () => {
  it.each([
    ['PT', ptBR.landingV2, 'pt-BR' as const, 'Minhas solicitações'],
    ['EN', en.landingV2, 'en' as const, 'My requests'],
  ])('%s: link para /vender/minhas depois do CTA e ANTES do seletor de idioma', (_n, dict, locale, rotulo) => {
    render(<TopBar dict={dict} locale={locale} />);
    const link = screen.getByRole('link', { name: rotulo });
    expect(link.getAttribute('href')).toBe('/vender/minhas');
    const nav = link.closest('nav')!;
    const filhos = [...nav.children];
    const idxLink = filhos.indexOf(link);
    const idxIdioma = filhos.findIndex((c) => c.classList.contains('lang'));
    expect(idxLink).toBeGreaterThan(-1);
    expect(idxLink).toBeLessThan(idxIdioma);
    // não é o CTA do hero nem substitui as âncoras editoriais
    expect(link.classList.contains('contact')).toBe(false);
    expect(nav.querySelectorAll('a[href^="#"]').length).toBeGreaterThanOrEqual(5);
  });

  it('Esc fecha o menu do celular e devolve o foco ao botão', () => {
    render(<TopBar dict={ptBR.landingV2} locale="pt-BR" />);
    const botao = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(botao);
  });
});
