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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAppPrivy } from '@/lib/hooks/privy';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // `getAccessToken` do Privy não tem identidade estável; guardamos numa ref pra
  // o `refresh` não ser recriado a cada render (evita refetch de /me à toa).
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;
  // Estado mais recente, lido dentro do refresh sem entrar nas deps.
  const dataRef = useRef(data);
  dataRef.current = data;
  // Retry agendado (sem F5) enquanto o token ainda não mintou pós-login.
  const refreshRef = useRef<() => void>(() => {});
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const refresh = useCallback(async () => {
    // Logout real (Privy diz não-autenticado) é o ÚNICO ponto que limpa o estado.
    if (!authenticated) {
      setData(EMPTY);
      setLoading(false);
      retryCount.current = 0;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      return;
    }
    if (!dataRef.current.pessoaId) setLoading(true);
    try {
      // O token do Privy pode vir null logo após login/navegação. Espera ele
      // aparecer antes de decidir qualquer coisa — não chama /me sem Bearer.
      //
      // CRÍTICO: logo após login interativo, `getAccessToken()` pode TRAVAR
      // (promise pendente pra sempre) até um reload — o token ainda não foi
      // mintado/trocado. Um await sem timeout aqui nunca chega no `finally`,
      // deixando `loading` preso e as telas em "Verificando acesso…" eterno
      // (some no F5 porque aí o token já está em storage). Corrida com timeout
      // garante que o loop sempre termina e o loading sempre resolve.
      let token: string | null = null;
      for (let i = 0; i < 8; i++) {
        token = await Promise.race([
          getTokenRef.current().catch(() => null),
          sleep(2000).then(() => null),
        ]);
        if (token) break;
        await sleep(300);
      }
      if (!token) {
        // Token ainda não veio, mas Privy diz autenticado → transitório.
        // Mantém o estado atual (não rebaixa um usuário verificado) e agenda
        // uma nova tentativa pra carregar /me SEM exigir F5 do usuário.
        // Limitado: ~10 tentativas (15s) evitam polling infinito se o token
        // genuinamente nunca mintar.
        if (!retryTimer.current && retryCount.current < 10) {
          retryCount.current += 1;
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            refreshRef.current();
          }, 1500);
        }
        return;
      }
      // Token chegou: cancela qualquer retry pendente e zera o contador.
      retryCount.current = 0;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      // Timeout defensivo: sem isso, um /me lento/travado deixaria `loading`
      // preso em true pra sempre, e as páginas que esperam o estado assentar
      // (/entrar, /painel) ficariam presas em "Verificando acesso".
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let res: Response;
      try {
        res = await fetch('/api/conta/me', {
          headers: { authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        // 401/5xx com token presente e Privy autenticado → tratamos como
        // transitório: preserva o estado anterior em vez de zerar o KYC.
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
      // Rede/transitório → não apaga o estado.
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  // Mantém a ref do refresh atual pro retry agendado disparar a versão certa.
  refreshRef.current = () => {
    void refresh();
  };

  // Limpa qualquer retry pendente ao desmontar.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

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
