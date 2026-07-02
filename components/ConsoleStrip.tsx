'use client';

import type { Dictionary } from '@/lib/i18n/types';

export default function ConsoleStrip({ dict }: { dict: Dictionary['consoleStrip'] }) {
  return (
    <div className="w-full bg-base border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.16em]">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 h-8 flex items-center justify-center gap-3">
          <span className="relative flex w-1.5 h-1.5 shrink-0" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-primary animate-pulse-dot" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-white/70">
            {dict.aberto}
          </span>
          <span className="text-white/30" aria-hidden>·</span>
          <a
            href="#lead-capture"
            className="shrink-0 text-primary hover:text-white transition-colors duration-200"
          >
            {dict.cta}
          </a>
      </div>
    </div>
  );
}
