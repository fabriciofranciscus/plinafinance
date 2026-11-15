'use client';

/**
 * /historico: lista cronológica da conta (spec de UX da Íris, item 13). Dados de
 * GET /api/me/historico (contrato do Bento, item 12, ainda pendente). `?exemplo=1`
 * mostra itens fictícios com a faixa "Dados de exemplo", só para pré-visualização.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import HistoricoView, { type FiltroHistorico } from '@/components/me/HistoricoView';
import { useHistorico } from '@/components/me/useHistorico';
import { useRequireAuth } from '@/lib/hooks/use-require-auth';
import { HISTORICO_EXEMPLO } from '@/lib/me/exemplos';

function HistoricoInner() {
  const params = useSearchParams();
  const exemplo = params.get('exemplo') ? HISTORICO_EXEMPLO : null;
  const { checking, authenticated } = useRequireAuth();
  const { estado, recarregar, carregarMais } = useHistorico(exemplo);
  const [filtro, setFiltro] = useState<FiltroHistorico>('tudo');

  if (checking || !authenticated) {
    return (
      <p role="status" className="mx-auto max-w-6xl px-6 py-14 font-text text-sm text-base/70">
        Verificando acesso…
      </p>
    );
  }
  return (
    <HistoricoView
      exemplo={!!exemplo}
      estado={estado}
      filtro={filtro}
      onFiltro={setFiltro}
      onTentarDeNovo={recarregar}
      onCarregarMais={carregarMais}
    />
  );
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={null}>
      <HistoricoInner />
    </Suspense>
  );
}
