'use client';

export default function ConsoleStrip() {
  return (
    <div className="w-full bg-base border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.16em]">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 h-8 flex items-center justify-center gap-3">
          <span className="relative flex w-1.5 h-1.5 shrink-0" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-primary animate-pulse-dot" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-white/70">
            Captação aberta para investidores institucionais qualificados
          </span>
          <span className="text-white/30" aria-hidden>·</span>
          <a
            href="#lead-capture"
            className="shrink-0 text-primary hover:text-white transition-colors duration-200"
          >
            Solicitar Prospecto →
          </a>
      </div>
    </div>
  );
}
