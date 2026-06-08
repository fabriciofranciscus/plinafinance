'use client';

/**
 * PessoaProvider — estado de conta/KYC compartilhado (header + wizard /vender).
 *
 * Busca `/api/conta/me` (Bearer Privy) uma vez quando o usuário está logado e
 * expõe { authenticated, kycAprovado, papeis, ... } via contexto. Fonte única
 * pra gating de UI por papel e pro fluxo de KYC do cedente.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useAppPrivy } from '@/lib/hooks/privy';

export interface PessoaState {
  loading: boolean;
  authenticated: boolean;
  pessoaId: string | null;
  nome: string | null;
  email: string | null;
  kycAprovado: boolean;
  kycStatus: string | null;
  papeis: string[];
  refresh: () => Promise<void>;
}

const PessoaContext = createContext<PessoaState | null>(null);

const EMPTY = {
  pessoaId: null as string | null,
  nome: null as string | null,
  email: null as string | null,
  kycAprovado: false,
  kycStatus: null as string | null,
  papeis: [] as string[],
};

export function PessoaProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = useAppPrivy();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!authenticated) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/conta/me', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setData(EMPTY);
        return;
      }
      const me = await res.json();
      setData({
        pessoaId: me.pessoaId ?? null,
        nome: me.nome ?? null,
        email: me.email ?? null,
        kycAprovado: !!me.kycAprovado,
        kycStatus: me.kycStatus ?? null,
        papeis: me.papeis ?? [],
      });
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready) {
      // Privy pode nunca inicializar (ex.: origin não permitido no dashboard,
      // rede). Não trava a UI: após um tempo, libera o loading pra mostrar o
      // painel de login em vez de um spinner eterno.
      const t = setTimeout(() => setLoading(false), 4000);
      return () => clearTimeout(t);
    }
    void refresh();
  }, [ready, refresh]);

  return (
    <PessoaContext.Provider value={{ loading, authenticated, ...data, refresh }}>
      {children}
    </PessoaContext.Provider>
  );
}

export function usePessoa(): PessoaState {
  const ctx = useContext(PessoaContext);
  if (!ctx) {
    throw new Error('usePessoa precisa estar dentro de <PessoaProvider>');
  }
  return ctx;
}
