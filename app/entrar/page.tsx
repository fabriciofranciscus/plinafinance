'use client';

/**
 * /entrar — login institucional dedicado.
 *
 * Centraliza o login (Google/email via Privy) que vivia duplicado dentro dos
 * fluxos. Lê `?next=` (path same-origin) e, depois do login, roteia:
 *   1. next válido → next
 *   2. senão → /painel (home pós-login; o painel é o seletor de caminho)
 *
 * O bridge de OAuth resolve globalmente no PrivyAppProvider, então esta página
 * não precisa hospedá-lo — um redirect do Google volta pra qualquer URL e ainda
 * completa a sessão.
 */

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useAppPrivy,
  useAppLoginWithEmail as useLoginWithEmail,
  useAppLoginWithOAuth as useLoginWithOAuth,
} from '@/lib/hooks/privy';
import { usePessoa } from '@/components/PessoaProvider';
import { LoginPanel } from '@/components/auth/LoginPanel';

function safeNext(raw: string | null): string | null {
  // Anti-open-redirect: só path same-origin (um único '/' inicial).
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

function EntrarInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { ready } = useAppPrivy();
  const pessoa = usePessoa();
  const emailLogin = useLoginWithEmail();
  const oauthLogin = useLoginWithOAuth();
  const routed = useRef(false);

  useEffect(() => {
    if (routed.current) return;
    if (!ready) return;
    if (!pessoa.authenticated) return; // ainda no formulário
    if (pessoa.loading) return; // espera /me + retry de token assentar

    routed.current = true;
    if (next) router.replace(next);
    else router.replace('/painel');
  }, [ready, pessoa.authenticated, pessoa.loading, next, router]);

  // Já autenticado (ou logando) → não pisca o formulário; mostra "verificando".
  const verifying = ready && pessoa.authenticated;

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-16 md:py-24">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          01 // Acesso · PLINA-RF
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold mt-4 tracking-tight leading-[1.05] text-base">
          Entrar na plataforma.
        </h1>
        <p className="font-text text-base mt-6 text-base/80 leading-relaxed max-w-prose">
          Acesso institucional ao pool de direitos creditórios PLINA-RF.
          Onboarding via wallet Stellar embedded e anchor LATAM regulada.
        </p>

        <div className="mt-12">
          {verifying ? (
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
              Verificando acesso…
            </p>
          ) : (
            <LoginPanel emailLogin={emailLogin} oauthLogin={oauthLogin} variant="standalone" />
          )}
        </div>

        <dl className="mt-16 pt-10 border-t border-light-hairline grid grid-cols-1 sm:grid-cols-3 gap-px bg-base/10">
          {[
            { k: 'Token', v: 'PLINA-RF' },
            { k: 'Lastro', v: 'FIDC / CVM 175' },
            { k: 'Rede', v: 'Stellar' },
          ].map((it) => (
            <div key={it.k} className="bg-white px-5 py-5">
              <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
                {it.k}
              </dt>
              <dd className="font-mono text-sm mt-2 text-base">{it.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function EntrarPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
            Carregando…
          </p>
        </div>
      }
    >
      <EntrarInner />
    </Suspense>
  );
}
