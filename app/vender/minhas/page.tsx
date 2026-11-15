'use client';

/**
 * /vender/minhas: "Minhas solicitações" do cedente. Quem não está logado vai
 * para /entrar?next=/vender/minhas (useRequireAuth). A lista vem de
 * GET /api/vender/minhas e só tem os leads da própria conta.
 */

import WizardHeader from '@/components/vender/WizardHeader';
import MinhasSolicitacoes from '@/components/vender/MinhasSolicitacoes';
import { useRequireAuth } from '@/lib/hooks/use-require-auth';

export default function MinhasPage() {
  const { checking, authenticated } = useRequireAuth();
  return (
    <div className="min-h-screen bg-sheet-white text-base">
      <WizardHeader active="cotistas" />
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {checking || !authenticated ? (
          <p role="status" className="font-text text-sm text-base/70">
            Verificando acesso…
          </p>
        ) : (
          <MinhasSolicitacoes />
        )}
      </main>
    </div>
  );
}
