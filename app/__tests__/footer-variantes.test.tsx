// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/pool';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));

import { AppFooter } from '@/components/AppFooter';
import { AppShell } from '@/components/AppShell';

// Briefing visual v2 (Atlas, 17/11): footer melhor no /admin e footer no fluxo autenticado (/vender, /comprar), que hoje
// não tem nenhum. Só composição: todo texto vem do AppFooter atual, nada novo.
const ISSUER = 'GCN34WOPABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMWLGA7E';
const TESTNET = 'Ambiente de testnet · tokens sem valor real';
const LEI = 'Testnet · sem oferta pública (Lei 11.795/2008)';
const BLURB = 'Cotas contempladas de consórcio, com registro verificável na';

afterEach(cleanup);

describe('variantes do AppFooter', () => {
  it('completo (padrão): igual a hoje, com a frase de apresentação e as três colunas', () => {
    render(<AppFooter issuerPubkey={ISSUER} />);
    const f = screen.getByRole('contentinfo');
    expect(f.getAttribute('data-variante')).toBe('completo');
    expect(f.textContent).toContain(BLURB);
    for (const t of ['Auditável', 'Status', TESTNET, LEI, '© 2026 Plina Finance']) expect(f.textContent).toContain(t);
  });

  it('compacto (funil): marca, direitos, links de prova, aviso de testnet e a linha legal; sem a frase de apresentação', () => {
    render(<AppFooter issuerPubkey={ISSUER} variante="compacto" />);
    const f = screen.getByRole('contentinfo');
    expect(f.getAttribute('data-variante')).toBe('compacto');
    expect(f.textContent).not.toContain(BLURB);
    for (const t of ['Plina', '© 2026 Plina Finance', TESTNET, LEI, 'Pool de demonstração · NAV', 'Política de clawback', 'contato@plina.finance']) expect(f.textContent).toContain(t);
    const hrefs = within(f).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/pool', '/politica-clawback', 'mailto:contato@plina.finance']));
  });

  it('operação (admin): rede, issuer com link, stellar.toml, Stellar Expert, aviso de testnet; sem a frase de apresentação', () => {
    render(<AppFooter issuerPubkey={ISSUER} variante="operacao" />);
    const f = screen.getByRole('contentinfo');
    expect(f.getAttribute('data-variante')).toBe('operacao');
    expect(f.textContent).not.toContain(BLURB);
    for (const t of ['Stellar Testnet', `${ISSUER.slice(0, 8)}…${ISSUER.slice(-6)}`, '.well-known/stellar.toml', 'Stellar Expert · PLINA-RF →', TESTNET, LEI]) expect(f.textContent).toContain(t);
    const issuer = within(f).getByRole('link', { name: `${ISSUER.slice(0, 8)}…${ISSUER.slice(-6)}` });
    expect(issuer.getAttribute('href')).toBe(`https://stellar.expert/explorer/testnet/account/${ISSUER}`);
    expect(issuer.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('links com alvo de 44 px no celular em todas as variantes', () => {
    for (const v of ['completo', 'compacto', 'operacao'] as const) {
      const { unmount } = render(<AppFooter issuerPubkey={ISSUER} variante={v} />);
      expect(screen.getByRole('contentinfo').className, v).toContain('max-md:[&_a]:min-h-[44px]');
      unmount();
    }
  });

  it('nenhuma variante tem texto abaixo do piso de contraste (sem lightBg/50 nem /40 nas variantes novas)', () => {
    for (const v of ['compacto', 'operacao'] as const) {
      const { container, unmount } = render(<AppFooter issuerPubkey={ISSUER} variante={v} />);
      expect(container.innerHTML, v).not.toMatch(/text-lightBg\/(30|40|50|55|60)\b/);
      unmount();
    }
  });
});

describe('AppShell escolhe o footer pela rota', () => {
  const variante = (p: string) => {
    pathname = p;
    const { unmount } = render(<AppShell isAdmin={false} issuerPubkey={ISSUER}><div>conteúdo</div></AppShell>);
    const f = screen.queryByRole('contentinfo');
    const v = f?.getAttribute('data-variante') ?? null;
    unmount();
    return v;
  };
  it('/vender e /comprar (e subrotas) recebem o compacto; antes não tinham nenhum', () => {
    for (const p of ['/vender', '/vender/acompanhar/abc', '/vender/minhas', '/comprar', '/comprar/res-1/comprovante']) expect(variante(p), p).toBe('compacto');
  });
  it('/admin recebe a variante de operação', () => {
    expect(variante('/admin')).toBe('operacao');
  });
  it('as demais rotas com shell seguem com o completo e as rotas com chrome próprio seguem sem footer', () => {
    for (const p of ['/pool', '/investir', '/minha-posicao', '/inicio', '/historico', '/cotas']) expect(variante(p), p).toBe('completo');
    for (const p of ['/', '/privacidade', '/lab']) expect(variante(p), p).toBeNull();
  });
  it('o conteúdo da página continua renderizado, antes do footer', () => {
    pathname = '/comprar';
    render(<AppShell isAdmin={false} issuerPubkey={ISSUER}><div data-testid="pagina">conteúdo</div></AppShell>);
    const pag = screen.getByTestId('pagina');
    expect(pag.compareDocumentPosition(screen.getByRole('contentinfo')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
