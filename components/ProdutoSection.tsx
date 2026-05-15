import SectionMarker from './SectionMarker';

const especificacoes = [
  {
    label: 'Lastro',
    value: '1 PLINA-RF = R$ 1,00',
    detail: 'Lastro em direito creditório com valor ajustado diariamente.',
  },
  {
    label: 'Veículo',
    value: 'FIDC · CVM 175',
    detail: 'Classes sênior e subordinada, prestadores registrados, auditoria Big Four.',
  },
  {
    label: 'Custódia',
    value: 'Custodiante regulado',
    detail: 'Registro digital auditável com bloqueio, autorização e reversibilidade institucional.',
  },
  {
    label: 'Aporte',
    value: 'USD · EUR · BRL',
    detail: 'Aceitamos investidores internacionais e domésticos via moedas digitais reguladas.',
  },
];

export default function ProdutoSection() {
  return (
    <section id="produto" className="py-32 bg-white relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="01" label="Produto" />
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
            PLINA<span className="text-primary-deep">-RF</span>
            <span className="text-primary-deep">.</span>
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            Cota de FIDC representada por um instrumento digital regulado, emitido sob a CVM 175. Não é uma corretora. Não é um fundo aberto de varejo. É o próprio instrumento financeiro tokenizado, com originação, custódia regulada e controles de conformidade integrados.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-light-hairline border-y border-light-hairline reveal delay-100">
          {especificacoes.map((spec) => (
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
