'use client';

import { useEffect, useState } from 'react';

export function OnboardingProgress() {
  const phases = [
    'Criando wallet Stellar embedded',
    'Registrando customer na anchor',
    'Submetendo KYC programático',
    'Confirmando aprovação',
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= phases.length) return;
    const id = setTimeout(() => setStep((s) => s + 1), 1400);
    return () => clearTimeout(id);
  }, [step, phases.length]);

  return (
    <div>
      <ol className="space-y-px bg-base/10 border-y border-light-hairline">
        {phases.map((p, idx) => {
          const isDone = idx < step;
          const isCurrent = idx === step;
          return (
            <li
              key={p}
              className="relative bg-white px-5 py-4 flex items-center gap-5"
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isDone || isCurrent ? 'scale-y-100' : 'scale-y-0'
                } ${isCurrent ? 'bg-primary' : 'bg-base/25'}`}
              />
              <span
                className={`font-mono text-xs transition-colors ${
                  isDone ? 'text-primary-deep' : isCurrent ? 'text-base' : 'text-base/35'
                }`}
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span
                className={`font-text text-sm transition-colors flex-1 ${
                  isCurrent ? 'text-base' : isDone ? 'text-base/70' : 'text-base/40'
                }`}
              >
                {p}
                {isCurrent && <span className="animate-pulse">…</span>}
              </span>
              {isDone && (
                <span
                  className="font-mono text-[10px] text-primary-deep"
                  aria-label="concluído"
                >
                  ✓
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-3">
        Sandbox auto-aprova · ~3-8s
      </p>
    </div>
  );
}
