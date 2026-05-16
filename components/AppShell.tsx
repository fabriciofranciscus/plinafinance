'use client';

/**
 * AppShell — wrap das superfícies do app com header + footer.
 *
 * Esconde-se em rotas que têm chrome próprio:
 *   - `/` (landing tem SiteHeader próprio)
 *   - `/lab` (dev sandbox)
 *
 * Server Component parent (`app/layout.tsx`) detecta admin via cookie e
 * passa via prop. Investor state vem do Privy (client-side).
 */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { AppFooter } from './AppFooter';

interface AppShellProps {
  children: ReactNode;
  isAdmin: boolean;
  issuerPubkey: string;
}

// Rotas com chrome próprio (landing /) ou que precisam ser standalone:
//   /vender, /comprar — superfícies de funil com voz própria (PRODUCT.md §5).
//   /lab — sandbox dev.
const ROUTES_WITHOUT_SHELL = ['/', '/lab', '/vender', '/comprar'];

export function AppShell({ children, isAdmin, issuerPubkey }: AppShellProps) {
  const pathname = usePathname();
  const hideShell = ROUTES_WITHOUT_SHELL.some(
    (r) => pathname === r || (r !== '/' && pathname.startsWith(r)),
  );

  if (hideShell) return <>{children}</>;

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader isAdmin={isAdmin} />
      <main className="flex-1">{children}</main>
      <AppFooter issuerPubkey={issuerPubkey} />
    </div>
  );
}
