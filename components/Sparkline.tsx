type Tone = 'light' | 'dark' | 'accent';

type Props = {
  points: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  className?: string;
  animate?: boolean;
};

const strokeFor: Record<Tone, string> = {
  light: '#057A99',
  dark: '#A0CFE7',
  accent: '#0EA7C7',
};

export default function Sparkline({
  points,
  width = 96,
  height = 24,
  tone = 'light',
  className = '',
  animate = true,
}: Props) {
  if (points.length === 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p - min) / range) * (height - 2) - 1;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const lastX = (points.length - 1) * stepX;
  const lastY =
    height - ((points[points.length - 1] - min) / range) * (height - 2) - 1;

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke={strokeFor[tone]}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? 'animate-sparkline' : undefined}
        style={animate ? { strokeDasharray: 200, strokeDashoffset: 200 } : undefined}
      />
      <circle cx={lastX} cy={lastY} r="1.5" fill={strokeFor[tone]} />
    </svg>
  );
}
