'use client';

/**
 * /painel — hub pessoal pós-login.
 *
 * Role-aware: investidor cai na Dashboard rica (extrato institucional, 6 telas,
 * que absorveu a antiga /minha-posicao); cedente e primeiro acesso sem papel
 * veem o Hub de atalhos. Client component porque o token Privy é client-side.
 *
 * Guarda: deslogado → /entrar?next=/painel.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppPrivy } from '@/lib/hooks/privy';
import { usePessoa } from '@/components/PessoaProvider';
import Dashboard from './_components/dashboard';
import Hub from './_components/hub';

export default function PainelPage() {
  const router = useRouter();
  const { ready } = useAppPrivy();
  const pessoa = usePessoa();
  const routed = useRef(false);

  useEffect(() => {
    if (routed.current) return;
    if (!ready || pessoa.loading) return;
    if (!pessoa.authenticated) {
      routed.current = true;
      router.replace('/entrar?next=/painel');
    }
  }, [ready, pessoa.loading, pessoa.authenticated, router]);

  if (!ready || pessoa.loading || !pessoa.authenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando…
        </p>
      </div>
    );
  }

  const isInvestidor = pessoa.papeis.includes('INVESTIDOR');

  return isInvestidor ? (
    <Dashboard
      nome={pessoa.nome}
      papeis={pessoa.papeis}
      kycAprovado={pessoa.kycAprovado}
      kycStatus={pessoa.kycStatus}
    />
  ) : (
    <Hub
      nome={pessoa.nome}
      papeis={pessoa.papeis}
      kycAprovado={pessoa.kycAprovado}
      kycStatus={pessoa.kycStatus}
    />
  );
}
