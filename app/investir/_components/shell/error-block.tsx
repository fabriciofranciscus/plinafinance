'use client';

import { useState } from 'react';
import type { FlowError } from '../../_types';

export function ErrorBlock({
  error,
  onDismiss,
}: {
  error: FlowError;
  onDismiss: () => void;
}) {
  const [showTech, setShowTech] = useState(false);
  return (
    <div role="alert" className="mt-10 bg-white border border-base/20">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-light-hairline">
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-deep" aria-hidden />
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
            Operação interrompida
          </p>
        </div>
        <span className="font-mono text-[10px] text-base/55 tracking-wide">
          {error.ticketId}
        </span>
      </div>
      <p className="font-text text-sm text-base/85 leading-relaxed px-5 py-5">
        {error.message}
      </p>
      <div className="border-t border-light-hairline px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <button
          onClick={() => setShowTech((v) => !v)}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base"
        >
          {showTech ? '— Detalhes técnicos' : '+ Detalhes técnicos'}
        </button>
        <a
          href={`mailto:contato@plina.finance?subject=Incidente%20${encodeURIComponent(error.ticketId)}&body=${encodeURIComponent(`Ticket: ${error.ticketId}\n\nMensagem técnica:\n${error.technical}`)}`}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep hover:text-base"
        >
          Reportar incidente →
        </a>
        <button
          onClick={onDismiss}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base ml-auto"
        >
          Dispensar
        </button>
      </div>
      {showTech && (
        <pre className="bg-lightBg/60 border-t border-light-hairline px-5 py-4 font-mono text-[10px] text-base/70 whitespace-pre-wrap break-all">
          {error.technical}
        </pre>
      )}
    </div>
  );
}
