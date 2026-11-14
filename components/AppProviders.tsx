'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrivyAppProvider } from '@/components/PrivyAppProvider';
import { PessoaProvider } from '@/components/PessoaProvider';

/**
 * Providers de conta/carteira do app. A landing (`/`) não usa login nem
 * carteira: sem o Privy montado ela não faz nenhum pedido a outro domínio
 * (auth.privy.io, WalletConnect) — critério "sem recurso externo" do LD3. A página
 * /privacidade (LV9) segue a mesma regra: não carrega nada além da landing.
 * As demais rotas seguem como antes.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/privacidade') return <>{children}</>;
  return (
    <PrivyAppProvider>
      <PessoaProvider>{children}</PessoaProvider>
    </PrivyAppProvider>
  );
}
