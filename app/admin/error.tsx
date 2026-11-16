'use client';

import { useEffect } from 'react';

/**
 * Falha ao carregar o painel (GUIA-PARTE-2 §12). Mostra só o `digest` do Next (identificador que a equipe casa com o
 * log do servidor); a mensagem do erro nunca vai para a tela. Nada foi enviado: é leitura.
 */
export default function ErroDoPainel({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // O detalhe fica no console do operador e no log do servidor (pelo digest); não entra na interface.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div role="alert" className="max-w-2xl border border-light-hairline bg-sheet-white p-6">
        <h1 className="font-title text-2xl font-semibold tracking-tight">Não foi possível carregar o painel.</h1>
        <p className="font-text text-sm text-base/80 mt-3 leading-relaxed">
          Nenhuma ação foi enviada. Tente de novo; se continuar, avise a equipe técnica com o código abaixo.
        </p>
        <p className="font-mono text-[11px] text-base/70 mt-3 break-all">{error.digest ?? 'sem código'}</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-5 min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-5 py-2 hover:bg-primary-deep transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
