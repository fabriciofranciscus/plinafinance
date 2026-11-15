// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScrollRegion } from '@/components/ui/ScrollRegion';
import { AppFooter } from '@/components/AppFooter';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(cleanup);

describe('ScrollRegion', () => {
  it('é uma região focável por teclado, com nome acessível, que contém a tabela', () => {
    render(
      <ScrollRegion label="Cotas no pool">
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </ScrollRegion>,
    );
    const r = screen.getByRole('region', { name: 'Cotas no pool' });
    expect(r.tabIndex).toBe(0);
    expect(r.className).toContain('overflow-x-auto');
    expect(r.querySelector('table')).not.toBeNull();
  });
});

describe('AppFooter', () => {
  it('a marca "Plina" não usa text-base (cor de fundo do rodapé): usa a cor clara', () => {
    render(<AppFooter issuerPubkey="GBRG4JKO7R2R3OXPTQHL6TIZ5ZVF57YXHQ3547UYMV35TSW5Y6VUZOLB" />);
    const marca = screen.getAllByText(/^Plina/).find((e) => e.tagName === 'P')!;
    expect(marca.className).toContain('text-lightBg');
    expect(marca.className.split(/\s+/)).not.toContain('text-base');
  });
});
