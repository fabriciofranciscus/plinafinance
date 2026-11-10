/**
 * Ícones da landing v2 (landing-v2/assets/icons): traço 1,25, currentColor,
 * sempre decorativos (aria-hidden). Tamanho: 1em (a seta das linhas de
 * "Para quem" ajusta o font-size do pai).
 */
type Name = 'arrow-up-right' | 'arrow-down' | 'pause' | 'play';

const PATHS: Record<Name, { d: string; join?: 'miter' }> = {
  'arrow-up-right': { d: 'M4 12 12 4M5.5 4H12v6.5' },
  'arrow-down': { d: 'M8 2.5v11M3.5 9 8 13.5 12.5 9' },
  pause: { d: 'M5.5 3v10M10.5 3v10' },
  play: { d: 'M4.5 3 12.5 8l-8 5z', join: 'miter' },
};

export function Icon({ name, className = '' }: { name: Name; className?: string }) {
  const p = PATHS[name];
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap={p.join ? undefined : 'square'}
      strokeLinejoin={p.join}
      aria-hidden="true"
      focusable="false"
    >
      <path d={p.d} />
    </svg>
  );
}
