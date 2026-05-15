'use client';

import { useEffect, useState } from 'react';

function fmtStamp(d: Date) {
  const Y = d.getUTCFullYear();
  const M = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const D = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  return `${Y}.${M}.${D} ${h}:${m}:${s}`;
}

const FLAGS = [
  'Plina-RF v1',
  'FIDC CVM 175',
  'Lei 11.795/2008',
  'Auditoria Big Four',
  'Custódia Regulada',
  'Reversibilidade Institucional',
];

export default function ConsoleFooter() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const stamp = now ? fmtStamp(now) : '----.--.-- --:--:--';

  return (
    <div
      role="contentinfo"
      aria-label="Build & system flags"
      className="bg-base text-white/45 border-t border-white/10 font-mono text-[9px] uppercase tracking-[0.2em] overflow-x-auto"
    >
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-x-4 whitespace-nowrap">
        <span className="tabular-nums shrink-0 text-white/35">{stamp} UTC</span>
        {FLAGS.map((flag) => (
          <span key={flag} className="flex items-center gap-x-4 shrink-0">
            <span className="text-white/25" aria-hidden>·</span>
            <span>{flag}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
