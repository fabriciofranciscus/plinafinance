/**
 * Carregando o painel (GUIA-PARTE-2 §12): sobretítulo e título já no lugar, uma frase em `role="status"`.
 * Sem brilho animado nem transição: nada a parar em `prefers-reduced-motion`.
 */
export default function Loading() {
  return (
    <div className="plina-product mx-auto max-w-[var(--workspace-max)] px-[var(--spacing-gutter-ui)] py-8 md:py-12">
      <header className="mb-8">
        <p className="font-details text-label-ui text-base/70">Operação · acesso restrito</p>
        <h1 className="font-title text-page-title mt-2">Painel Plina</h1>
      </header>
      <p role="status" className="font-text text-sm text-base/70">
        Carregando o painel…
      </p>
    </div>
  );
}
