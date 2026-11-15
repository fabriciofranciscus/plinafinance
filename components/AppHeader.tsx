'use client';

/**
 * AppHeader — chrome compartilhado das superfícies do app (não-landing).
 *
 * Role-aware:
 *   - public (não logado): Pool · Cotas · Política · Investir
 *   - investor (Privy logado): Pool · Política · Investir · Minha posição · address abreviado · Sair
 *   - admin (cookie plina_admin): Pool · Operação · Sair
 *
 * Doutrina DESIGN.md:
 *   - Hairline border-bottom, sem sombra.
 *   - bg-sheet-white sobre claro (todas as superfícies do app são claras).
 *   - "Plina." em Chillax 600 com ponto cyan-deep (sobre claro).
 *   - Nav links em Geist 700 uppercase tracking-widest 0.6875rem.
 *   - Current page: barra cyan 1×100% animada por scaleX (signature pattern).
 *   - Address abreviado em Geist Mono.
 *   - Testnet badge: chip discreto bg-document-grey, sem cor de alerta.
 */

import { usePrivy, useLogout } from '@privy-io/react-auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { itemAtivo, itensDoMenu } from '@/lib/nav/menu';
import { usePessoa } from '@/components/PessoaProvider';

interface AppHeaderProps {
  isAdmin: boolean;
}

function abbreviate(pubkey: string): string {
  if (pubkey.length < 12) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-6)}`;
}

export function AppHeader({ isAdmin }: AppHeaderProps) {
  const { ready, authenticated, user } = usePrivy();
  const { logout } = useLogout();
  const { papeis, loading: carregandoPapeis } = usePessoa();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);

  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => a.address.startsWith('G'))?.address ?? null;

  const logado = !isAdmin && ready && authenticated;
  const links = itensDoMenu({
    isAdmin,
    authenticated: ready && authenticated,
    carregandoPapeis,
    papeis,
  });

  // O painel do celular fecha ao navegar e com Esc.
  useEffect(() => setAberto(false), [pathname]);
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto]);

  const sair = async () => {
    if (isAdmin) {
      // N-11: fetch + custom header (CSRF defense). Form HTML permitiria POST cross-site via SameSite=lax.
      await fetch('/api/admin/logout', { method: 'POST', headers: { 'x-plina-admin': '1' } });
      window.location.href = '/admin';
    } else {
      void logout();
    }
  };

  return (
    <header className="bg-white border-b border-light-hairline sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-title text-lg font-semibold tracking-tight text-base">
            Plina<span className="text-primary-deep">.</span>
          </Link>
          <nav aria-label="Principal" className="hidden lg:flex items-center gap-6">
            {links.map((l) => {
              const active = itemAtivo(l.href, pathname, links);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  className="relative font-details text-[11px] tracking-[0.2em] uppercase font-bold text-base/80 hover:text-base transition-colors py-4"
                >
                  {l.label}
                  <span
                    className={`absolute left-0 right-0 -bottom-px h-[2px] bg-primary origin-left transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      active ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin ? (
            <span className="hidden sm:inline-flex font-details text-[10px] tracking-[0.2em] uppercase bg-base text-lightBg px-2 py-1">
              Admin
            </span>
          ) : logado && stellarAddress ? (
            <span className="hidden lg:inline font-mono text-[11px] text-base/60" title={stellarAddress}>
              {abbreviate(stellarAddress)}
            </span>
          ) : !logado ? (
            <span className="hidden sm:inline-flex font-details text-[10px] tracking-[0.2em] uppercase bg-lightBg text-base/70 px-2 py-1">
              Testnet
            </span>
          ) : null}
          {(isAdmin || logado) && (
            <button
              type="button"
              onClick={() => void sair()}
              className="hidden lg:inline-flex items-center min-h-[44px] font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base"
            >
              Sair
            </button>
          )}
          <button
            type="button"
            aria-expanded={aberto}
            aria-controls="menu-principal"
            onClick={() => setAberto((v) => !v)}
            className="lg:hidden min-h-[44px] min-w-[44px] px-3 font-details text-[10px] tracking-[0.2em] uppercase border border-light-hairline text-base"
          >
            {aberto ? 'Fechar' : 'Menu'}
          </button>
        </div>
      </div>

      <div id="menu-principal" hidden={!aberto} className="lg:hidden border-t border-light-hairline bg-white">
        <nav aria-label="Principal (celular)">
          <ul>
            {links.map((l) => {
              const active = itemAtivo(l.href, pathname, links);
              return (
                <li key={l.href} className="border-b border-light-hairline">
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className="flex min-h-[48px] items-center justify-between px-6 font-details text-[11px] tracking-[0.2em] uppercase font-bold text-base"
                  >
                    {l.label}
                    {active && <span aria-hidden="true">●</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {(isAdmin || logado) && (
          <div className="px-6 py-3 flex items-center justify-between">
            {logado && stellarAddress ? (
              <span className="font-mono text-[11px] text-base/60" title={stellarAddress}>
                Carteira {abbreviate(stellarAddress)}
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => void sair()}
              className="min-h-[44px] font-details text-[10px] tracking-[0.2em] uppercase text-base/80"
            >
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
