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
    const stage = canvas.closest<HTMLElement>('.hero-stage');
    const ribbon = mountRibbon(canvas, { stage, paused: reduced || pausedRef.current });
    ribbonRef.current = ribbon;
    return () => {
      ribbon.destroy();
      ribbonRef.current = null;
    };
  }, []);

  useEffect(() => {
    ribbonRef.current?.setPaused(paused);
  }, [paused]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
