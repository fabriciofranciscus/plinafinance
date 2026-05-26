'use client';

import { useEffect, useMemo, useState } from 'react';
import { QUOTE_TTL_MS } from '../../_lib/glossary';

export function useExpiresIn(expiresAt?: string | null): string | null {
  const target = useMemo(() => {
    if (!expiresAt) return null;
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t)) return t;
    return Date.now() + QUOTE_TTL_MS;
  }, [expiresAt]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  const diffMs = target - now;
  if (diffMs <= 0) return '00:00';
  const s = Math.floor(diffMs / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
