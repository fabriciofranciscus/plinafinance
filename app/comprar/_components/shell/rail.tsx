import type { Screen } from '../../_types';
import { PHASES, SCREENS } from '../../_lib/glossary';

const SCREEN_LABEL: Record<Screen, string> = Object.fromEntries(
  SCREENS.map((s) => [s.id, s.label]),
) as Record<Screen, string>;

const ORDER: Screen[] = SCREENS.map((s) => s.id);

export function Rail({ current }: { current: Screen }) {
  const currentIdx = ORDER.indexOf(current);
  const isDone = (s: Screen) => ORDER.indexOf(s) < currentIdx;

  return (
    <div className="px-8 py-12 h-full flex flex-col">
      <div className="mb-12">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          Comprar · cota contemplada
        </p>
        <p className="font-title text-lg font-semibold mt-3 tracking-tight leading-tight text-base">
          Aquisição com deságio
        </p>
      </div>

      <ol className="space-y-px bg-base/10 -mx-8">
        {PHASES.map((phase, idx) => {
          const isCurrent = phase.screens.includes(current);
          const phaseDone = phase.screens.every((s) => isDone(s));
          return (
            <li
              key={phase.id}
              className={`relative bg-lightBg px-8 py-5 transition-colors duration-300 ${
                isCurrent ? 'bg-white' : ''
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isCurrent
                    ? 'scale-y-100 bg-primary'
                    : phaseDone
                      ? 'scale-y-100 bg-base/25'
                      : 'scale-y-0 bg-base/15'
                }`}
              />
              <div className="flex items-baseline gap-4">
                <span
                  className={`font-mono text-xs transition-colors ${
                    phaseDone ? 'text-primary-deep' : isCurrent ? 'text-base' : 'text-base/35'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span
                  className={`font-details text-[11px] tracking-[0.2em] uppercase transition-colors ${
                    isCurrent ? 'text-base' : phaseDone ? 'text-base/70' : 'text-base/40'
                  }`}
                >
                  {phase.label}
                </span>
              </div>

              {isCurrent && phase.screens.length > 1 && (
                <ul className="mt-3 ml-8 space-y-1.5">
                  {phase.screens.map((sid) => {
                    const subCurrent = sid === current;
                    const subDone = isDone(sid);
                    return (
                      <li key={sid} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`h-1 w-1 rounded-full ${
                            subCurrent ? 'bg-primary' : subDone ? 'bg-base/40' : 'bg-base/20'
                          }`}
                        />
                        <span
                          className={`font-details text-[10px] tracking-[0.18em] uppercase ${
                            subCurrent
                              ? 'text-base font-bold'
                              : subDone
                                ? 'text-base/60'
                                : 'text-base/35'
                          }`}
                        >
                          {SCREEN_LABEL[sid]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-auto pt-12">
        <p className="font-mono text-[10px] text-base/55 leading-relaxed">
          CVM 175 · FIDC<br />
          Cessão registrada on-chain · Stellar testnet
        </p>
      </div>
    </div>
  );
}
