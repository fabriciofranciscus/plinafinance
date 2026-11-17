'use client';

import { useEffect } from 'react';

/**
 * Falha ao carregar o painel (GUIA-PARTE-2 §12). Mostra só o `digest` do Next (identificador que a equipe casa com o
 * log do servidor); a mensagem do erro nunca vai para a tela. O texto não garante que nenhuma ação anterior foi
 * enviada (um erro de renderização não prova isso, parecer da Íris) e "Tentar de novo" só recarrega a leitura.
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
    <div className="plina-product mx-auto max-w-[var(--workspace-max)] px-[var(--spacing-gutter-ui)] py-8 md:py-12">
      <div role="alert" className="max-w-2xl rounded-panel border border-light-hairline bg-sheet-white p-4 md:p-6">
        <h1 className="font-title text-page-title">Não foi possível carregar o painel.</h1>
        <p className="font-text text-body-ui text-base/80 mt-3">
          Tente carregar o painel novamente. Se você havia enviado uma ação, consulte o resultado antes de repeti-la.
        </p>
        {error.digest && (
          <p className="font-text text-body-small text-base/70 mt-3">
            Código de referência: <span className="font-mono break-all">{error.digest}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-base text-lightBg font-details text-label-ui px-6 hover:bg-signal-700 transition-colors duration-[var(--duration-fast)] ease-terminal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-700"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
