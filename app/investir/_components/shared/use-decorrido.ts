'use client';

import { useEffect, useState } from 'react';

/** Tempo decorrido desde `desde` (ISO), "mm:ss", atualizado a cada segundo. `null` sem data válida. Sobrevive a recarregar (vem do servidor). */
export function useDecorrido(desde?: string | null): string | null {
  const inicio = desde ? Date.parse(desde) : NaN;
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(inicio)) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inicio]);
  if (!Number.isFinite(inicio)) return null;
  const s = Math.max(0, Math.floor((agora - inicio) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
