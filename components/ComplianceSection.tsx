import SectionMarker from './SectionMarker';

const principios = [
  {
    num: '01',
    titulo: 'Auditável',
    tag: 'Verificável publicamente · Registro imutável',
    detalhe:
      'Cada cota incorporada ao pool tem registro digital verificável publicamente, com lastro jurídico formal e imutável.',
  },
  {
    num: '02',
    titulo: 'Regulada',
    tag: 'CVM 175 · Lei 11.795/2008',
    detalhe:
      'CVM 175 e Lei 11.795/2008 desde a origem. FIDC formal, prestadores registrados, auditoria Big Four.',
  },
  {
    num: '03',
    titulo: 'Reversível',
    tag: 'Clawback · Autorização · Revogabilidade',
    detalhe:
      'Política pública restrita a quatro hipóteses jurídicas explícitas. Reversibilidade institucional como diferencial competitivo, não como limitação técnica.',
  },
];


export default function ComplianceSection() {
  return (
    <section id="compliance" className="py-32 bg-white relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="04" label="Compliance" />
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
            Compliance
            <br />
            nativo.
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            Para mesa de risco institucional, reversibilidade não é limitação. É requisito. Family offices e gestoras reguladas não alocam em ativo digital sem mecanismo formal de bloqueio e recuperação. Sem isso, o produto não passa em compliance.
          </p>
        </div>

        {/* Asymmetric editorial principles */}
        <div className="mb-32">
          {principios.map((p, i) => {
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
