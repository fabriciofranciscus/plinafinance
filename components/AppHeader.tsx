'use client';

/**
 * AppHeader — chrome compartilhado das superfícies do app (não-landing).
 *
 * Role-aware:
 *   - public (não logado): Pool · Política · Investir
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
import { usePathname } from 'next/navigation';

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
  const pathname = usePathname();

  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => a.address.startsWith('G'))?.address ?? null;

  const links = isAdmin
    ? [{ href: '/admin', label: 'Operação' }, { href: '/pool', label: 'Pool' }]
    : authenticated
      ? [
          { href: '/pool', label: 'Pool' },
          { href: '/cotas', label: 'Cotas' },
          { href: '/politica-clawback', label: 'Política' },
          { href: '/investir', label: 'Investir' },
          { href: '/minha-posicao', label: 'Minha posição' },
        ]
      : [
          { href: '/pool', label: 'Pool' },
          { href: '/cotas', label: 'Cotas' },
          { href: '/politica-clawback', label: 'Política' },
          { href: '/investir', label: 'Investir' },
        ];

  return (
    <header className="bg-white border-b border-light-hairline sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="font-title text-lg font-semibold tracking-tight text-base"
          >
            Plina<span className="text-primary-deep">.</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {links.map((l) => {
              const active =
                pathname === l.href ||
                (l.href !== '/' && pathname.startsWith(l.href));
              return (
                <Link
                  key={l.href}
                  href={l.href}
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
            <>
              <span className="hidden sm:inline-flex font-details text-[10px] tracking-[0.2em] uppercase bg-base text-lightBg px-2 py-1">
                Admin
              </span>
              <button
                onClick={async () => {
                  // N-11: fetch + custom header (CSRF defense). Form HTML
                  // permitiria POST cross-site via SameSite=lax.
                  await fetch('/api/admin/logout', {
                    method: 'POST',
                    headers: { 'x-plina-admin': '1' },
                  });
                  window.location.href = '/admin';
                }}
                className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base"
              >
                Sair
              </button>
            </>
          ) : ready && authenticated && stellarAddress ? (
            <>
              <span
                className="hidden sm:inline font-mono text-[11px] text-base/60"
                title={stellarAddress}
              >
                {abbreviate(stellarAddress)}
              </span>
              <button
                onClick={() => logout()}
                className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base"
              >
                Sair
              </button>
            </>
          ) : (
            <span className="hidden sm:inline-flex font-details text-[10px] tracking-[0.2em] uppercase bg-lightBg text-base/70 px-2 py-1">
              POC · Testnet
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
