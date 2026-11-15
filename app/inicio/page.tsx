'use client';

/**
 * /inicio: tela de entrada de quem está logado (spec de UX da Íris, item 13).
 * Dados de GET /api/me/resumo (contrato do Bento, item 12, ainda pendente).
 * `?exemplo=1` mostra dados fictícios com a faixa "Dados de exemplo", só para
 * pré-visualização; sem o parâmetro a tela usa o endpoint real.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import InicioView from '@/components/me/InicioView';
import { useMe } from '@/components/me/useMe';
import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import { RESUMO_CONTA_NOVA_EXEMPLO, RESUMO_EXEMPLO } from '@/lib/me/exemplos';
import type { ResumoDaConta } from '@/lib/me/tipos';

function InicioInner() {
  const params = useSearchParams();
  const exemploParam = params.get('exemplo');
  const exemplo = exemploParam === 'nova' ? RESUMO_CONTA_NOVA_EXEMPLO : exemploParam ? RESUMO_EXEMPLO : null;
  const { checking, authenticated } = useRequireAuth();
  const { estado, recarregar } = useMe<ResumoDaConta>('/api/me/resumo', { exemplo });

  if (checking || !authenticated) {
    return (
      <p role="status" className="mx-auto max-w-6xl px-6 py-14 font-text text-sm text-base/70">
        Verificando acesso…
      </p>
    );
  }
  return (
    <InicioView
      exemplo={!!exemplo}
      estado={
        estado.tipo === 'ok'
          ? { tipo: 'ok', resumo: estado.dados }
          : estado.tipo === 'erro'
            ? { tipo: 'erro', onTentarDeNovo: recarregar }
            : { tipo: 'carregando' }
      }
    />
  );
}

export default function InicioPage() {
  return (
    <Suspense fallback={null}>
      <InicioInner />
    </Suspense>
  );
}
