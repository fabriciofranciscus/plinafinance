import type { Screen } from '../../_types';
import { SCREENS } from '../../_lib/glossary';

export function Rail({
  current,
  onboard,
  quote,
  buyResult,
}: {
  current: Screen;
  onboard: boolean;
  quote: boolean;
  buyResult: boolean;
}) {
  const done: Record<Screen, boolean> = {
    welcome: current !== 'welcome',
    identity: onboard && current !== 'identity',
    banking:
      current !== 'welcome' &&
      current !== 'identity' &&
      current !== 'banking',
    quote:
      quote &&
      current !== 'quote' &&
      current !== 'identity' &&
      current !== 'banking',
    onramp:
      current === 'settling' ||
      current === 'claiming' ||
      current === 'confirm' ||
      current === 'receipt',
    settling:
      current === 'claiming' ||
      current === 'confirm' ||
      current === 'receipt',
    claiming: current === 'confirm' || current === 'receipt',
    confirm: buyResult,
    receipt: false,
  };

  return (
    <div className="px-8 py-12 h-full flex flex-col">
      <div className="mb-12">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          Investir · PLINA-RF
        </p>
        <p className="font-title text-lg font-semibold mt-3 tracking-tight leading-tight text-base">
          Acesso institucional ao pool
        </p>
      </div>

      <ol className="space-y-px bg-base/10 -mx-8">
        {SCREENS.map((s, idx) => {
          const isCurrent = s.id === current;
          const isDone = done[s.id];
          return (
            <li
              key={s.id}
              className={`relative bg-lightBg px-8 py-5 transition-colors duration-300 ${
                isCurrent ? 'bg-white' : ''
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isCurrent
                    ? 'scale-y-100 bg-primary'
                    : isDone
                      ? 'scale-y-100 bg-base/25'
                      : 'scale-y-0 bg-base/15'
                }`}
              />
              <div className="flex items-baseline gap-4">
                <span
                  className={`font-mono text-xs transition-colors ${
                    isDone ? 'text-primary-deep' : isCurrent ? 'text-base' : 'text-base/35'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span
                  className={`font-details text-[11px] tracking-[0.2em] uppercase transition-colors ${
                    isCurrent
                      ? 'text-base'
                      : isDone
                        ? 'text-base/70'
                        : 'text-base/40'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto pt-12">
        <p className="font-mono text-[10px] text-base/55 leading-relaxed">
          CVM 175 · FIDC<br />
          Stellar testnet · Etherfuse sandbox
        </p>
      </div>
    </div>
  );
}
