// @vitest-environment jsdom
/**
 * M2 (backlog de usabilidade 25/11): o `cotaId` não pode se perder no redirect do login. Ciclo completo:
 * /comprar/reservar?cotaId=X (sem sessão) → /entrar?next=<url inteira> → safeNext devolve a MESMA url com a query.
 * O relatório do achado rodou numa branch antiga; na main o hook já preserva a query (e171d42), e este teste a trava.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/comprar/reservar' }));
const privy = vi.hoisted(() => ({ ready: true, authenticated: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }), usePathname: () => nav.pathname }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => privy }));

import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import { safeNext } from '@/lib/auth/safe-next';

const ORIGEM = 'http://localhost';
const irPara = (url: string) => window.history.replaceState(null, '', url);

beforeEach(() => {
  nav.replace.mockReset();
  nav.pathname = '/comprar/reservar';
  privy.ready = true; privy.authenticated = false;
});

describe('useRequireAuth — link profundo da reserva', () => {
  it('sem sessão em /comprar/reservar?cotaId=X: manda ao /entrar com a URL inteira em next, e o safeNext a devolve com o cotaId', () => {
    irPara('/comprar/reservar?cotaId=cmcota123abc');
    renderHook(() => useRequireAuth());
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const destino = nav.replace.mock.calls[0]![0] as string;
    expect(destino.startsWith('/entrar?next=')).toBe(true);
    const next = new URL(destino, ORIGEM).searchParams.get('next');
    expect(next).toBe('/comprar/reservar?cotaId=cmcota123abc');
    expect(safeNext(next, ORIGEM)).toBe('/comprar/reservar?cotaId=cmcota123abc');
  });

  it.each([
    ['/comprar/reservar?cotaId=a&origem=lista', '/comprar/reservar?cotaId=a&origem=lista'],
    ['/comprar/reservar?cotaId=a%20b', '/comprar/reservar?cotaId=a%20b'],
    ['/comprar/reservar?cotaId=x#topo', '/comprar/reservar?cotaId=x'], // o hash não vai ao servidor nem ao `next`: fora do escopo
  ])('preserva a query em %s', (entrada, esperado) => {
    irPara(entrada);
    renderHook(() => useRequireAuth());
    const next = new URL(nav.replace.mock.calls[0]![0] as string, ORIGEM).searchParams.get('next');
    expect(safeNext(next, ORIGEM)).toBe(esperado);
  });

  it('com sessão: não redireciona; Privy ainda iniciando: espera', () => {
    irPara('/comprar/reservar?cotaId=x');
    privy.authenticated = true;
    renderHook(() => useRequireAuth());
    expect(nav.replace).not.toHaveBeenCalled();
    privy.authenticated = false; privy.ready = false;
    renderHook(() => useRequireAuth());
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('um cotaId malicioso não vira open redirect: o safeNext recusa o que sair da mesma origem', () => {
    expect(safeNext('/\\evil.com?cotaId=x', ORIGEM)).toBeNull();
    expect(safeNext('//evil.com/comprar/reservar?cotaId=x', ORIGEM)).toBeNull();
  });
});
