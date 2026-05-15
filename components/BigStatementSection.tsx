import SectionMarker from './SectionMarker';

const milestones = [
  { year: '2008', label: 'Lei 11.795 regulamenta consórcios brasileiros' },
  { year: '2023', label: 'CVM 175 estrutura tokenização institucional' },
  { year: '2026', label: 'Plina · primeira tokenizadora de direito creditório de consórcio' },
];

export default function BigStatementSection() {
  return (
    <section
      id="marco-regulatorio"
      aria-labelledby="big-statement-heading"
      className="bg-base text-white py-32 lg:py-40 relative overflow-hidden"
    >
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="03" label="Marco Regulatório" tone="dark" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-12 items-end reveal">
          <h2
            id="big-statement-heading"
            className="lg:col-span-8 font-title font-medium text-white"
            style={{
              fontSize: 'clamp(4rem, 13vw, 12rem)',
              lineHeight: 0.85,
              letterSpacing: '-0.05em',
            }}
          >
            <span className="block">2008</span>
            <span className="block text-primary">→ 2026.</span>
          </h2>

          <div className="lg:col-span-4">
            <p className="font-text text-white/70 text-lg font-light leading-relaxed mb-8">
              A Lei 11.795 regulamentou o mercado brasileiro de consórcios em 2008. Há quase duas décadas o direito creditório de cotas contempladas é juridicamente formado, mas nunca chegou ao capital institucional global.
            </p>
            <p className="font-text text-white text-lg font-medium leading-relaxed">
              A Plina é a primeira tokenizadora institucional sob CVM 175 desde a origem.
            </p>
          </div>
        </div>

        <ol className="mt-24 grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/10 border-y border-white/10 reveal delay-100">
          {milestones.map((m, i) => (
            <li
              key={m.year}
              className="bg-base px-6 py-8 flex flex-col gap-4 relative"
            >
              <span className="font-mono text-[10px] text-white/40 uppercase tracking-[0.22em]">
                Δ{(i + 1).toString().padStart(2, '0')}
              </span>
              <span
                className="font-title font-semibold text-white tabular-nums"
                style={{
                  fontSize: 'clamp(2rem, 4.2vw, 3.5rem)',
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}
              >
                {m.year}
              </span>
              <span className="font-mono text-[11px] text-white/65 uppercase tracking-[0.18em] leading-relaxed">
                {m.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
