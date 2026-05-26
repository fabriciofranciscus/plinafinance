'use client';

/**
 * Wrappers de hooks Privy com modo stub controlado por env
 * `NEXT_PUBLIC_E2E_PRIVY_STUB`. Em produção: passthrough total —
 * branches `STUB` são eliminados pelo bundler via constant fold de
 * `process.env.NEXT_PUBLIC_*`.
 *
 * Pra que stub serve: Playwright E2E full flow (`*-full-flow.spec.ts`)
 * não pode fazer login Privy interativo + signing MPC. Em stub, hooks
 * leem keypair Stellar de localStorage (semeado pelo spec) e assinam
 * raw hash com `Keypair.sign` direto. Backend correspondente:
 * `lib/wallet/privy.ts` aceita Bearer `e2e-stub-<pubkey>` com
 * `PRIVY_VERIFY_STUB=true`.
 *
 * Risco zero em prod: ramo morto não compila se a env não é exatamente
 * 'true'.
 */

import {
  usePrivy as usePrivyReal,
  useLoginWithEmail as useLoginWithEmailReal,
  useLoginWithOAuth as useLoginWithOAuthReal,
  useLogout as useLogoutReal,
} from '@privy-io/react-auth';
import { useSignRawHash as useSignRawHashReal } from '@privy-io/react-auth/extended-chains';
import { Keypair } from '@stellar/stellar-sdk';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export const STUB_ENABLED =
  process.env.NEXT_PUBLIC_E2E_PRIVY_STUB === 'true';

// =============================================================================
// Stub context (só usado quando STUB_ENABLED=true)
// =============================================================================

interface StubSession {
  pubkey: string;
  secret: string;
  email: string;
  userId: string;
}

const StubContext = createContext<StubSession | null>(null);

export function StubPrivyProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StubSession | null>(null);

  useEffect(() => {
    // Spec injeta via addInitScript → localStorage antes do React montar.
    const pubkey = localStorage.getItem('e2e_stub_pubkey');
    const secret = localStorage.getItem('e2e_stub_secret');
    const email = localStorage.getItem('e2e_stub_email') ?? 'e2e@plina.test';
    const userId =
      localStorage.getItem('e2e_stub_user_id') ?? `did:privy:e2e-${pubkey}`;
    if (pubkey && secret) {
      setSession({ pubkey, secret, email, userId });
    }
  }, []);

  return (
    <StubContext.Provider value={session}>{children}</StubContext.Provider>
  );
}

// =============================================================================
// Hook wrappers
// =============================================================================

interface AppPrivy {
  ready: boolean;
  authenticated: boolean;
  user: { id: string; email?: { address: string } } | null;
  getAccessToken: () => Promise<string | null>;
  login: () => void;
}

export function useAppPrivy(): AppPrivy {
  if (STUB_ENABLED) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const session = useContext(StubContext);
    return {
      ready: true,
      authenticated: !!session,
      user: session
        ? { id: session.userId, email: { address: session.email } }
        : null,
      getAccessToken: async () =>
        session ? `e2e-stub-${session.pubkey}` : null,
      login: () => {
        // noop em stub — spec já injetou sessão via localStorage
      },
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const real = usePrivyReal();
  return {
    ready: real.ready,
    authenticated: real.authenticated,
    user: real.user as AppPrivy['user'],
    getAccessToken: real.getAccessToken,
    login: real.login,
  };
}

interface AppLoginWithEmail {
  sendCode: (input: { email: string }) => Promise<unknown>;
  loginWithCode: (input: { code: string }) => Promise<unknown>;
  state: {
    status:
      | 'initial'
      | 'sending-code'
      | 'awaiting-code-input'
      | 'submitting-code'
      | 'error'
      | 'done';
    error?: { message: string };
  };
}

export function useAppLoginWithEmail(): AppLoginWithEmail {
  if (STUB_ENABLED) {
    return {
      sendCode: async () => undefined,
      loginWithCode: async () => undefined,
      state: { status: 'initial' },
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLoginWithEmailReal() as unknown as AppLoginWithEmail;
}

interface AppLoginWithOAuth {
  initOAuth: (input?: unknown) => Promise<unknown>;
  loading: boolean;
  state: {
    status: 'initial' | 'loading' | 'error' | 'done';
    error?: { message: string };
  };
}

export function useAppLoginWithOAuth(): AppLoginWithOAuth {
  if (STUB_ENABLED) {
    return {
      initOAuth: async () => undefined,
      loading: false,
      state: { status: 'initial' },
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLoginWithOAuthReal() as unknown as AppLoginWithOAuth;
}

interface AppLogout {
  logout: () => Promise<void> | void;
}

export function useAppLogout(): AppLogout {
  if (STUB_ENABLED) {
    return { logout: () => undefined };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const real = useLogoutReal();
  return { logout: real.logout };
}

interface AppSignRawHash {
  signRawHash: (input: {
    address: string;
    chainType: 'stellar';
    hash: `0x${string}`;
  }) => Promise<{ signature: string }>;
}

export function useAppSignRawHash(): AppSignRawHash {
  if (STUB_ENABLED) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const session = useContext(StubContext);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const signRawHash = useCallback(
      async ({ hash }: { address: string; chainType: 'stellar'; hash: `0x${string}` }) => {
        if (!session) throw new Error('E2E stub session ausente');
        const kp = Keypair.fromSecret(session.secret);
        const hashBuf = Buffer.from(hash.slice(2), 'hex');
        const sig = kp.sign(hashBuf);
        return { signature: '0x' + sig.toString('hex') };
      },
      [session],
    );
    return { signRawHash };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const real = useSignRawHashReal();
  return { signRawHash: real.signRawHash as AppSignRawHash['signRawHash'] };
}
