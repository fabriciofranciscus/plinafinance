'use client';

import { useEffect, useRef } from 'react';
import { mountRibbon, type RibbonHandle } from './ribbon';
import { useMotion } from './LandingRoot';

/** Fita procedural do hero (SPEC §5.4). Decorativa: aria-hidden, sem ponteiro. */
export function RibbonCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ribbonRef = useRef<RibbonHandle | null>(null);
  const { paused } = useMotion();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // LM-2: no celular (<= 760 px) a fita fica parada, sem controle de pausa.
    const phone = matchMedia('(max-width: 760px)');
    const stage = canvas.closest<HTMLElement>('.hero-stage');
    const ribbon = mountRibbon(canvas, { stage, paused: reduced || phone.matches || pausedRef.current });
    ribbonRef.current = ribbon;
    const onPhone = () => ribbon.setPaused(phone.matches || pausedRef.current);
    phone.addEventListener('change', onPhone);
    return () => {
      phone.removeEventListener('change', onPhone);
      ribbon.destroy();
      ribbonRef.current = null;
    };
  }, []);

  useEffect(() => {
    ribbonRef.current?.setPaused(paused || matchMedia('(max-width: 760px)').matches);
  }, [paused]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
