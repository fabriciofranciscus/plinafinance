import SectionMarker from './SectionMarker';
import type { Dictionary } from '@/lib/i18n/types';

export default function ComplianceSection({ dict }: { dict: Dictionary['compliance'] }) {
  return (
    <section id="compliance" className="py-32 bg-white relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num={dict.numMarker} label={dict.marker} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-12 items-end mb-32 reveal">
          <h2
            className="lg:col-span-8 font-title font-semibold text-base"
            style={{
              fontSize: 'clamp(3rem, 8.5vw, 7rem)',
              lineHeight: 0.95,
              letterSpacing: '-0.04em',
            }}
          >
            {dict.titulo.map((linha, i) => (
              <span key={i}>
                {linha}
                {i < dict.titulo.length - 1 && <br />}
              </span>
            ))}
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            {dict.intro}
          </p>
        </div>

        {/* Asymmetric editorial principles */}
        <div className="mb-32">
          {dict.principios.map((p, i) => {
            const isMirrored = i === 1;
            return (
              <article
                key={p.num}
                className={`grid grid-cols-12 gap-x-6 lg:gap-x-8 items-end py-16 lg:py-20 border-b border-light-hairline reveal ${
                  i === 0 ? '' : i === 1 ? 'delay-100' : 'delay-200'
                } ${i === 0 ? 'border-t border-light-hairline' : ''}`}
              >
                <div
                  className={`col-span-12 lg:col-span-7 ${
                    isMirrored ? 'lg:order-2 lg:col-start-6' : 'lg:order-1'
                  }`}
                >
                  <span
                    className="font-mono font-light text-base/15 leading-none block tabular-nums"
                    style={{
                      fontSize: 'clamp(6rem, 16vw, 14rem)',
                      letterSpacing: '-0.06em',
                    }}
                  >
                    {p.num}
                  </span>
                </div>
                <div
                  className={`col-span-12 lg:col-span-5 mt-6 lg:mt-0 ${
                    isMirrored ? 'lg:order-1 lg:col-start-1' : 'lg:order-2'
                  }`}
                >
                  <span className="font-mono text-[10px] text-primary-deep font-bold uppercase tracking-[0.22em] block mb-5">
                    {p.tag}
                  </span>
                  <h3
                    className="font-title font-semibold text-base mb-6 tracking-tight"
                    style={{
                      fontSize: 'clamp(2.25rem, 4.5vw, 4rem)',
                      lineHeight: 1.02,
                      letterSpacing: '-0.025em',
                    }}
                  >
                    {p.titulo}
                  </h3>
                  <p className="font-text text-base/70 text-lg font-light leading-relaxed max-w-md">
                    {p.detalhe}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

    </section>
  );
}
