import SectionMarker from './SectionMarker';

const membros = [
  {
    operatorId: '01',
    nome: 'Fabrício Santos',
    cargo: 'CEO & Founder',
    bio: 'Sócio fundador da Citrino, assessoria financeira de planejamento e gestão patrimonial. Atuou em estratégias de receita, custo e experiência do cliente na plataforma digital de crédito Simplic, e liderou na TOTVS a implementação do sistema corporativo de KPIs para a Diretoria e o Conselho Administrativo.',
    delay: '',
  },
  {
    operatorId: '02',
    nome: 'Thais Reis',
    cargo: 'CTO & Protocol Lead',
    bio: 'Engenheira full-stack com cinco anos em infraestrutura blockchain — engenharia de dados, backend, contratos automatizados em Rust e interfaces em React/TypeScript. Fundadora e Lead Engineer do Karn Ecosystem, plataforma de governança de código aberto. Premiada em competições nacionais e internacionais de tecnologia descentralizada e inteligência artificial.',
    delay: 'delay-100',
  },
];

export default function EquipeSection() {
  return (
    <section id="equipe" className="py-32 bg-lightBg">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="05" label="Equipe Fundadora" />
        </div>

        <div className="space-y-24 lg:space-y-32">
          {membros.map((m) => (
            <article
              key={m.nome}
              className={`relative grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-8 items-end reveal ${m.delay}`}
            >
              {/* Vertical operator label — desktop only */}
              <span
                aria-hidden
                className="hidden lg:flex absolute -left-12 xl:-left-16 top-0 items-center font-mono text-[10px] uppercase tracking-[0.3em] text-base/40"
                style={{
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                }}
              >
                [operator/{m.operatorId}] · {m.cargo}
              </span>

              <div className="lg:col-span-8">
                <span className="font-mono text-[10px] text-base/40 uppercase tracking-[0.22em] mb-4 block lg:hidden">
                  [operator/{m.operatorId}]
                </span>
                <h3
                  className="font-title font-semibold text-base"
                  style={{
                    fontSize: 'clamp(3rem, 9vw, 7.5rem)',
                    lineHeight: 0.92,
                    letterSpacing: '-0.04em',
                  }}
                >
                  {m.nome}
                </h3>
                <span className="font-mono text-xs text-primary-deep font-bold tracking-[0.2em] uppercase mt-6 block">
                  {m.cargo}
                </span>
              </div>
              <p className="lg:col-span-4 font-text text-base/70 text-base md:text-lg font-light leading-relaxed">
                {m.bio}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
