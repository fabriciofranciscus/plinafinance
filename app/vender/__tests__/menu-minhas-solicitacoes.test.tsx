// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/vender/minhas';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: null }),
  useLogout: () => ({ logout: vi.fn() }),
}));
vi.mock('@/components/PessoaProvider', () => ({ usePessoa: () => ({ papeis: ['CEDENTE'] }) }));

import { AppHeader } from '@/components/AppHeader';
import WizardHeader from '@/components/vender/WizardHeader';

afterEach(cleanup);

const barraAtiva = (nome: string) => {
  const link = screen.getAllByRole('link', { name: nome })[0]!;
  return link.querySelector('span.scale-x-100') !== null;
};

describe('link "Minhas solicitações" no menu', () => {
  it('AppHeader (cedente): existe, aponta para /vender/minhas e só ele acende em /vender/minhas', () => {
    pathname = '/vender/minhas';
    render(<AppHeader isAdmin={false} />);
    expect(screen.getByRole('link', { name: 'Minhas solicitações' }).getAttribute('href')).toBe('/vender/minhas');
    expect(barraAtiva('Minhas solicitações')).toBe(true);
    expect(barraAtiva('Vender')).toBe(false);
  });

  it('AppHeader: em /vender acende "Vender", não "Minhas solicitações"', () => {
    pathname = '/vender';
    render(<AppHeader isAdmin={false} />);
    expect(barraAtiva('Vender')).toBe(true);
    expect(barraAtiva('Minhas solicitações')).toBe(false);
  });

  it('WizardHeader (logado): link visível com aria-current só na própria página', () => {
    pathname = '/vender/minhas';
    const u = render(<WizardHeader active="cotistas" />);
    expect(screen.getByRole('link', { name: 'Minhas solicitações' }).getAttribute('aria-current')).toBe('page');
    u.unmount();
    pathname = '/vender';
    render(<WizardHeader active="cotistas" />);
    const l = screen.getByRole('link', { name: 'Minhas solicitações' });
    expect(l.getAttribute('href')).toBe('/vender/minhas');
    expect(l.getAttribute('aria-current')).toBeNull();
  });
});
