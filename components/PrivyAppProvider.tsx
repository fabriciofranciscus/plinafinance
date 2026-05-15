'use client';

/**
 * Privy provider client-side. Wrap em volta do <html>/<body> via layout root
 * pra permitir hooks `useLogin`, `useWallets`, `useSignRawHash` em qualquer
 * Client Component.
 *
 * Padrão Yalla (`apps/web/src/providers/privy-provider.tsx`): mount global +
 * `useLoginWithOAuth` bridge pra OAuth callback funcionar em qualquer página.
 *
 * Stellar embedded wallet vem da configuração no dashboard.privy.io
 * (Wallets → Stellar). Login Privy provisiona automaticamente.
 */

import { PrivyProvider, useLoginWithOAuth } from '@privy-io/react-auth';
import type { ReactNode } from 'react';

function OAuthCallbackBridge() {
  useLoginWithOAuth();
  return null;
}

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    // Em dev sem Privy configurado, deixa filhos renderizarem normal.
    // Server actions que dependem de Privy vão falhar com mensagem clara.
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google'],
        embeddedWallets: {
          // Stellar é Tier 2 — não tem toggle no dashboard.privy.io.
          // Criada programaticamente via useCreateWallet({chainType:'stellar'})
          // de '@privy-io/react-auth/extended-chains' no client após login.
          // EVM/Solana off (não precisamos delas).
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
        appearance: {
          theme: 'light',
          accentColor: '#0EA7C7', // auditable-cyan do brand
          logo: '/icon.svg',
          landingHeader: 'Acesso institucional Plina',
        },
      }}
    >
      <OAuthCallbackBridge />
      {children}
    </PrivyProvider>
  );
}
