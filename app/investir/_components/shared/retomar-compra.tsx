'use client';

import { TEXTO_RETOMADA } from '@/lib/investir/texto-retomada';
import type { OrdemPendente } from '../../_types';

// Mantido aqui para quem já importava do componente (testes).
export { AVISO_PAGAMENTO_SIMULADO, TEXTO_RETOMADA } from '@/lib/investir/texto-retomada';

export function RetomarCompra({
  pendente,
  retomando,
  onRetomar,
}: {
  pendente: OrdemPendente;
  retomando: boolean;
  onRetomar: () => void;
}) {
  const t = TEXTO_RETOMADA[pendente.fase];
  return (
    <section
      role="region"
      aria-labelledby="retomar-compra-titulo"
      data-testid="retomar-compra"
      data-fase={pendente.fase}
      className="mb-10 border border-light-hairline bg-sheet-white px-5 py-5"
    >
      <h2 id="retomar-compra-titulo" className="font-title text-lg font-semibold tracking-tight">
        {t.titulo}
      </h2>
      <p className="font-text text-sm text-base/80 mt-2 max-w-prose leading-relaxed">{t.texto}</p>
      {t.botao && (
        <button
          type="button"
          onClick={onRetomar}
          disabled={retomando}
          className="mt-4 min-h-[44px] bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {retomando ? 'Preparando…' : t.botao}
        </button>
      )}
    </section>
  );
}
