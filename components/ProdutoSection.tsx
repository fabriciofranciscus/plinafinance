import SectionMarker from './SectionMarker';
import type { Dictionary } from '@/lib/i18n/types';

export default function ProdutoSection({ dict }: { dict: Dictionary['produto'] }) {
  return (
    <section id="produto" className="py-32 bg-white relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num={dict.numMarker} label={dict.marker} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-12 items-end mb-24 reveal">
          <h2
            className="lg:col-span-8 font-title font-semibold text-base"
            style={{
              fontSize: 'clamp(3.5rem, 11vw, 9rem)',
              lineHeight: 0.9,
              letterSpacing: '-0.045em',
            }}
          >
            {dict.titulo[0]}
            <span className="text-primary-deep">{dict.titulo[1]}</span>
            <span className="text-primary-deep">{dict.titulo[2]}</span>
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            {dict.intro}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-light-hairline border-y border-light-hairline reveal delay-100">
          {dict.especificacoes.map((spec) => (
            <div key={spec.label} className="bg-white p-8">
              <h3 className="font-mono text-[10px] text-base/60 font-bold uppercase tracking-widest mb-4">
                {spec.label}
              </h3>
              <p className="font-title font-semibold text-2xl text-base mb-3 tracking-tight">
                {spec.value}
              </p>
              <p className="font-text text-sm text-base/60 font-light leading-relaxed">
                {spec.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
