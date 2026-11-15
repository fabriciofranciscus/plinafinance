'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Área de rolagem horizontal contida para tabelas largas.
 *
 * A rolagem fica DENTRO da região (a página não ganha rolagem lateral): a
 * região é focável por teclado (setas rolam), tem nome acessível e anel de
 * foco do sistema. Quando há conteúdo escondido, aparece uma pista visível
 * (frase + seta discreta, FORA das células; sem degradê sobre a tabela: DS §12)
 * que some ao chegar ao fim.
 * Quem usa define a largura mínima da tabela (ex.: `min-w-[44rem]`).
 */
export function ScrollRegion({
  label,
  hint = 'Role para o lado para ver todas as colunas',
  children,
  className = '',
}: {
  label: string;
  /** Frase visível enquanto houver conteúdo escondido. */
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mais, setMais] = useState<{ esquerda: boolean; direita: boolean }>({
    esquerda: false,
    direita: false,
  });

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setMais({ esquerda: el.scrollLeft > 1, direita: max > 1 && el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [medir]);

  const transborda = mais.esquerda || mais.direita;

  return (
    <div className="relative">
      {transborda && mais.direita && (
        <p
          data-testid="scroll-hint"
          className="mb-2 font-details text-[10px] tracking-[0.2em] uppercase text-base/70"
        >
          {hint} <span aria-hidden="true">→</span>
        </p>
      )}
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={medir}
        className={`overflow-x-auto max-w-full border border-light-hairline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep ${className}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}
