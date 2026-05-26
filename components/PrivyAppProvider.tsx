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
import { StubPrivyProvider } from '@/lib/hooks/privy';

function OAuthCallbackBridge() {
  useLoginWithOAuth();
  return null;
}

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  // E2E stub: substitui PrivyProvider por StubPrivyProvider. Hooks reais
  // não são montados — wrappers em lib/hooks/privy direcionam pra Context
  // stub. Branch morto em prod via constant fold.
  if (process.env.NEXT_PUBLIC_E2E_PRIVY_STUB === 'true') {
    return <StubPrivyProvider>{children}</StubPrivyProvider>;
  }

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
        // Google requer OAuth client habilitado no dashboard.privy.io →
        // Login methods → Google. Se não estiver habilitado, o botão aparece
        // mas dá 403 no /oauth/init.
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
