// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/vender/minhas';
let papeis: string[] = ['CEDENTE'];
let carregando = false;
const logout = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { linkedAccounts: [{ address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' }] } }),
  useLogout: () => ({ logout }),
}));
vi.mock('@/components/PessoaProvider', () => ({ usePessoa: () => ({ papeis, loading: carregando }) }));

import { AppHeader } from '@/components/AppHeader';
import WizardHeader from '@/components/vender/WizardHeader';

afterEach(() => {
  cleanup();
  pathname = '/vender/minhas';
  papeis = ['CEDENTE'];
  carregando = false;
  logout.mockClear();
});

const desktop = () => within(screen.getByRole('navigation', { name: 'Principal' }));
const celular = () => within(screen.getByRole('navigation', { name: 'Principal (celular)', hidden: true }));

describe('AppHeader: menu único', () => {
  it('desktop: só o link mais específico fica aria-current (Minhas solicitações, não Vender)', () => {
    render(<AppHeader isAdmin={false} />);
    expect(desktop().getByRole('link', { name: 'Minhas solicitações' }).getAttribute('aria-current')).toBe('page');
    expect(desktop().getByRole('link', { name: 'Vender' }).getAttribute('aria-current')).toBeNull();
  });

  it('investidor: Sacar tem link no menu e Minha posição saiu', () => {
    papeis = ['INVESTIDOR'];
    pathname = '/inicio';
    render(<AppHeader isAdmin={false} />);
    expect(desktop().getByRole('link', { name: 'Sacar (testnet)' }).getAttribute('href')).toBe('/sacar');
    expect(desktop().queryByRole('link', { name: 'Minha posição' })).toBeNull();
    expect(desktop().getByRole('link', { name: 'Início' }).getAttribute('aria-current')).toBe('page');
  });

  it('celular: painel fechado, abre no botão Menu, vira Fechar, fecha com Esc', () => {
    render(<AppHeader isAdmin={false} />);
    const painel = document.getElementById('menu-principal')!;
    const botao = screen.getByRole('button', { name: 'Menu' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(botao.getAttribute('aria-controls')).toBe('menu-principal');
    expect(painel.hidden).toBe(true);
    fireEvent.click(botao);
    expect(painel.hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Fechar' }).getAttribute('aria-expanded')).toBe('true');
    expect(celular().getByRole('link', { name: /Minhas solicitações/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(painel.hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
  });

  it('celular: a carteira abreviada e o Sair ficam no painel; Sair chama o logout', () => {
    render(<AppHeader isAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const painel = within(document.getElementById('menu-principal')!);
    expect(painel.getByText(/Carteira GABC…/)).toBeTruthy();
    fireEvent.click(painel.getByRole('button', { name: 'Sair' }));
    expect(logout).toHaveBeenCalled();
  });

  it('papéis carregando: só Início e Histórico', () => {
    papeis = [];
    carregando = true;
    render(<AppHeader isAdmin={false} />);
    expect(desktop().getAllByRole('link').map((l) => l.textContent)).toEqual(['Início', 'Histórico']);
  });

  it('A-10: em /vender/minhas o cabeçalho tem UM só aria-current (Minhas solicitações), não também "Para Cotistas"', () => {
    pathname = '/vender/minhas';
    render(<WizardHeader active="cotistas" />);
    expect([...document.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent)).toEqual(['Minhas solicitações']);
    cleanup();
    pathname = '/vender';
    render(<WizardHeader active="cotistas" />);
    expect([...document.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent)).toEqual(['Para Cotistas']);
  });
});
