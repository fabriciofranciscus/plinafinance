import SectionMarker from './SectionMarker';
import Sparkline from './Sparkline';
import type { Dictionary } from '@/lib/i18n/types';

const sparklines: Record<string, number[]> = {
  A: [3, 5, 4, 7, 9, 8, 11, 14, 13, 17, 20, 23],
  B: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  C: [5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9],
};

export default function TeseSection({ dict }: { dict: Dictionary['tese'] }) {
  const caminhos = dict.caminhos;
  const metricas = [
    { chave: 'duration', label: dict.rowDuration },
    { chave: 'yieldLabel', label: dict.rowYield },
    { chave: 'mix', label: dict.rowMix },
  ] as const;

  return (
    <section id="tese" className="py-32 bg-lightBg relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num={dict.numMarker} label={dict.marker} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-12 items-end mb-20 reveal">
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

        {/* Comparison table */}
        <div className="reveal delay-100 -mx-6 px-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <caption className="sr-only">{dict.tableCaption}</caption>
            <thead>
              <tr className="border-y border-base/20">
                <th scope="col" className="text-left py-6 pr-6 align-bottom w-[18%]">
                  <span className="font-details text-[10px] font-bold uppercase tracking-widest text-base/60">
                    {dict.colCaminho}
                  </span>
                </th>
                {caminhos.map((c) => (
                  <th
                    key={c.letra}
                    scope="col"
                    className="text-left py-6 px-4 align-bottom border-l border-light-hairline"
                  >
                    <span className="font-mono text-3xl font-light text-secondary block mb-3">
                      {c.letra}
                    </span>
                    <span className="font-title font-semibold text-base lg:text-lg text-base tracking-tight leading-[1.2] block">
                      {c.titulo.map((linha, i) => (
                        <span key={i} className="block">
                          {linha}
                        </span>
                      ))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricas.map((m) => (
                <tr key={m.chave} className="border-b border-light-hairline">
                  <th scope="row" className="text-left py-5 pr-6 align-middle">
                    <span className="font-details text-[10px] font-bold uppercase tracking-widest text-base/60">
                      {m.label}
                    </span>
                  </th>
                  {caminhos.map((c) => (
                    <td
                      key={c.letra}
                      className="py-5 px-4 align-middle border-l border-light-hairline"
                    >
                      <span className="font-mono text-base lg:text-lg text-base font-medium">
                        {c[m.chave]}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="text-left py-5 pr-6 align-middle">
                  <span className="font-details text-[10px] font-bold uppercase tracking-widest text-base/60">
                    {dict.rowCurva}
                  </span>
                </th>
                {caminhos.map((c) => (
                  <td
                    key={c.letra}
                    className="py-5 px-4 align-middle border-l border-light-hairline"
                  >
                    <Sparkline points={sparklines[c.letra]} width={120} height={28} tone="light" />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Narrative blocks */}
        <div className="mt-16 grid grid-cols-1 lg:grid-cols-3 gap-px bg-light-hairline border-y border-light-hairline">
          {caminhos.map((c, i) => (
            <article
              key={c.letra}
              className={`bg-lightBg p-8 lg:p-10 reveal ${
                i === 0 ? 'delay-100' : i === 1 ? 'delay-200' : 'delay-300'
              }`}
            >
              <header className="flex items-baseline justify-between gap-4 mb-6">
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-2xl font-light text-secondary">
                    {c.letra}
                  </span>
                  <h3 className="font-title font-semibold text-lg text-base tracking-tight leading-[1.2]">
                    {c.titulo.join(' ')}
                  </h3>
                </div>
                <Sparkline points={sparklines[c.letra]} width={64} height={20} tone="light" />
              </header>
              <p className="font-text text-base/70 text-base font-light leading-relaxed">
                {c.body}
              </p>
            </article>
          ))}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-widest text-base/55 mt-12 max-w-3xl">
          {dict.rodape}
        </p>
      </div>
    </section>
  );
}
