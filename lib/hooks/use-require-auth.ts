'use client';

/**
 * useRequireAuth — guarda client-side de rota.
 *
 * Não há middleware nem proteção server-side (auth é 100% Privy client). Páginas
 * de ação (/investir, /vender, ...) chamam este hook: se o usuário não estiver
 * logado, redireciona pra /entrar?next=<rota atual>.
 *
 * A decisão "está logado?" depende SÓ do Privy (`ready` + `authenticated`) — NÃO
 * do fetch de /api/conta/me. Acoplar ao /me (papéis/KYC) travaria a página caso
 * esse fetch demore/falhe, mesmo com a sessão Privy válida. Papéis/KYC só são
 * necessários pro roteamento de /entrar e /painel, não pra este guard.
 *
 * Devolve `checking`: true enquanto o Privy não inicializou — o caller renderiza
 * um estado de espera silencioso em vez do conteúdo protegido.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppPrivy } from '@/lib/hooks/privy';

export function useRequireAuth(): { checking: boolean; authenticated: boolean } {
  const { ready, authenticated } = useAppPrivy();
  const pathname = usePathname();
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!ready) return; // espera o Privy inicializar
    if (!authenticated) {
      fired.current = true;
      router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, authenticated, pathname, router]);

  return { checking: !ready, authenticated };
}
