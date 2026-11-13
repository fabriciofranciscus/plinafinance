'use client';

import { Icon } from './icons';
import { useMotion } from './LandingRoot';

/** "Pausar movimento" / "Retomar movimento" (SPEC §5.6). */
export function MotionToggle({ pauseLabel, playLabel }: { pauseLabel: string; playLabel: string }) {
  const { paused, toggle } = useMotion();
  return (
    <button type="button" className="motion-toggle" aria-pressed={paused} onClick={toggle}>
      <Icon name={paused ? 'play' : 'pause'} />
      {paused ? playLabel : pauseLabel}
    </button>
  );
}
