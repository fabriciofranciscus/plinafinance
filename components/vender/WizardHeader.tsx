'use client';

/**
 * WizardHeader — barra superior das superfícies do funil do cedente.
 *
 * `/vender/*` roda sem o AppShell (ver `ROUTES_WITHOUT_SHELL`), então estas
 * telas precisam do próprio chrome. Tema claro, estrutura do mockup do CEO:
 * logo à esquerda, abas dos caminhos no centro, indicador de rede à direita.
 * Rede fixa em `testnet` (POC) — o env `STELLAR_NETWORK` não é público, e
 * importar `lib/stellar/config` no client puxaria o SDK pro bundle.
 *
 * Quando o cedente está logado (Privy), mostra o botão "Sair" à direita —
 * caso contrário não haveria como deslogar dentro do funil.
 */

import { usePrivy, useLogout } from '@privy-io/react-auth';
import Link from 'next/link';

type Caminho = 'cotistas' | 'investidores' | 'comprar';

const TABS: { id: Caminho; label: string; href: string }[] = [
  { id: 'cotistas', label: 'Para Cotistas', href: '/vender' },
  { id: 'investidores', label: 'Para Investidores', href: '/investir' },
  { id: 'comprar', label: 'Comprar Cota', href: '/comprar' },
];

export default function WizardHeader({ active }: { active: Caminho }) {
  const { ready, authenticated } = usePrivy();
  const { logout } = useLogout();

  return (
    <header className="border-b border-light-hairline bg-sheet-white">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between gap-6">
        <Link
          href="/"
          className="font-title font-semibold text-2xl tracking-tight text-base focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary rounded-sm"
          aria-label="Plina · Início"
        >
          Plina<span className="text-primary-deep">.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 font-details text-[11px] uppercase tracking-widest">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              aria-current={t.id === active ? 'page' : undefined}
              className={`rounded-md px-3 py-2 transition-colors whitespace-nowrap ${
                t.id === active
                  ? 'text-primary-deep font-bold'
                  : 'text-base/60 hover:text-base'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline font-mono text-[11px] text-base/50 whitespace-nowrap">
            stellar · testnet
          </span>
          {ready && authenticated && (
            <button
              onClick={() => logout()}
              className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base"
            >
              Sair
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
