type Props = {
  num: string;
  label: string;
  tone?: 'light' | 'dark';
  className?: string;
};

export default function SectionMarker({ num, label, tone = 'light', className = '' }: Props) {
  const mute = tone === 'dark' ? 'text-white/40' : 'text-base/40';
  const text = tone === 'dark' ? 'text-white/75' : 'text-base/70';

  return (
    <div className={`flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] ${className}`}>
      <span className={mute}>{num}</span>
      <span className={mute}>/</span>
      <span className={text}>{label}</span>
    </div>
  );
}
