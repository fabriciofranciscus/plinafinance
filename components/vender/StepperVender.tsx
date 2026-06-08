/**
 * StepperVender — stepper horizontal dos 6 passos do funil do cedente.
 *
 * Componente puro (sem hooks): renderiza tanto no wizard client (`/vender`)
 * quanto na página server de acompanhamento (`/vender/acompanhar/[leadId]`).
 * Os rótulos vêm de `ETAPAS_VENDER`; o passo atual é dirigido por `current`
 * (índice 0-based — no wizard é o passo local, no acompanhamento vem de
 * `etapaDoStatus`). Tema claro, estilo do mockup: círculos numerados ligados
 * por uma hairline, sem accent de borda lateral (proibido no design system).
 */

import { ETAPAS_VENDER } from '@/lib/vender/etapas';

interface StepperVenderProps {
  /** Índice 0-based do passo atual. -1 quando o funil foi encerrado. */
  current: number;
  /**
   * Quando definido, os passos viram botões clicáveis (usado no wizard
   * `/vender`). A página de acompanhamento (server) omite — stepper estático.
   */
  onStepClick?: (idx: number) => void;
  /**
   * Habilita o clique por passo (default: nenhum). Passos futuros dirigidos
   * pela mesa ficam bloqueados; só os já alcançados são clicáveis.
   */
  isStepEnabled?: (idx: number) => boolean;
}

export default function StepperVender({
  current,
  onStepClick,
  isStepEnabled,
}: StepperVenderProps) {
  return (
    <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
      <ol className="flex min-w-[680px] items-start">
        {ETAPAS_VENDER.map((etapa, idx) => {
          const isDone = current >= 0 && idx < current;
          const isCurrent = idx === current;
          const isLast = idx === ETAPAS_VENDER.length - 1;
          const clickable = !!onStepClick && (isStepEnabled?.(idx) ?? false);

          const inner = (
            <>
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs font-semibold transition-colors',
                  isDone
                    ? 'bg-primary-deep text-white'
                    : isCurrent
                      ? 'bg-primary text-base'
                      : 'bg-white text-base/40 border border-light-hairline',
                ].join(' ')}
              >
                {isDone ? '✓' : idx + 1}
              </span>
              <span
                className={[
                  'font-details text-[10px] leading-tight tracking-[0.14em] uppercase text-center transition-colors',
                  isCurrent
                    ? 'text-base font-bold'
                    : isDone
                      ? 'text-base/70'
                      : 'text-base/40',
                  clickable && !isCurrent ? 'group-hover:text-base' : '',
                ].join(' ')}
              >
                {etapa}
              </span>
            </>
          );

          const wrapperClass = 'flex flex-col items-center gap-2 w-28 shrink-0';

          return (
            <li
              key={etapa}
              className="flex flex-1 items-start gap-2 last:flex-none"
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(idx)}
                  className={`${wrapperClass} group cursor-pointer appearance-none bg-transparent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary rounded-sm`}
                >
                  {inner}
                </button>
              ) : (
                <div className={`${wrapperClass} ${onStepClick ? 'cursor-default' : ''}`}>
                  {inner}
                </div>
              )}
              {!isLast && (
                <span
                  aria-hidden
                  className={`mt-4 h-px flex-1 ${
                    isDone ? 'bg-primary-deep/40' : 'bg-light-hairline'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
