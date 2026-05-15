import SectionMarker from './SectionMarker';
import Sparkline from './Sparkline';

const caminhos = [
  {
    letra: 'A',
    titulo: 'Revenda ao\nComprador-Usuário',
    duration: '30-90 dias',
    yieldLabel: 'Alto',
    mix: '40-60%',
    sparkline: [3, 5, 4, 7, 9, 8, 11, 14, 13, 17, 20, 23],
    body: 'A diferença entre o preço pago ao vendedor original e o preço cobrado do comprador-usuário do bem é a fonte primária de yield. Operamos canal comercial dedicado para revenda de cotas a quem efetivamente vai usar a carta de crédito — pessoa física, construtora, transportadora, empresário.',
  },
  {
    letra: 'B',
    titulo: 'Liquidação por\nAdministradora',
    duration: '90-180 dias',
    yieldLabel: 'Médio',
    mix: '30-50%',
    sparkline: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    body: 'Para cotas elegíveis sob a Circular BACEN 3.432/2009, a administradora converte a contemplação em pagamento em dinheiro em até 180 dias. Caminho predominante dos incumbentes — operado pela Plina dentro da estrutura formal do FIDC, sem exposição regulatória de zona cinza.',
  },
  {
    letra: 'C',
    titulo: 'Liquidação por\nPrazo de Grupo',
    duration: '12-36 meses',
    yieldLabel: 'Contratado',
    mix: '10-20%',
    sparkline: [5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9],
    body: 'Para cotas não realizadas pelos caminhos A ou B, o direito creditório é realizado ao final do prazo regulado pelo BACEN com correção monetária contratual. Funciona como reserva técnica e piso de yield do pool.',
  },
];

const metricas = [
  { chave: 'duration', label: 'Duration' },
  { chave: 'yieldLabel', label: 'Yield' },
  { chave: 'mix', label: 'Mix-Alvo' },
] as const;

export default function TeseSection() {
  return (
    <section id="tese" className="py-32 bg-lightBg relative z-20">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-start justify-between mb-16">
          <SectionMarker num="02" label="Tese" />
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
            Três caminhos.
            <br />
            Um pool.
          </h2>
          <p className="lg:col-span-4 font-text text-base/70 text-lg font-light leading-relaxed">
            Modelo híbrido de realização de valor. Geridos ativamente pelo gestor do FIDC e auditados trimestralmente. É onde a Plina constrói vantagem competitiva durável sobre incumbentes restritos ao Caminho B.
          </p>
        </div>

        {/* Comparison table */}
        <div className="reveal delay-100 -mx-6 px-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <caption className="sr-only">
              Comparação dos três caminhos de realização de valor — duration, yield, mix-alvo e curva projetada
            </caption>
            <thead>
              <tr className="border-y border-base/20">
                <th scope="col" className="text-left py-6 pr-6 align-bottom w-[18%]">
                  <span className="font-details text-[10px] font-bold uppercase tracking-widest text-base/60">
                    Caminho
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
                      {c.titulo.split('\n').map((linha, i) => (
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
                    Curva projetada
                  </span>
                </th>
                {caminhos.map((c) => (
                  <td
                    key={c.letra}
                    className="py-5 px-4 align-middle border-l border-light-hairline"
                  >
                    <Sparkline points={c.sparkline} width={120} height={28} tone="light" />
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
                    {c.titulo.replace('\n', ' ')}
                  </h3>
                </div>
                <Sparkline points={c.sparkline} width={64} height={20} tone="light" />
              </header>
              <p className="font-text text-base/70 text-base font-light leading-relaxed">
                {c.body}
              </p>
            </article>
          ))}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-widest text-base/55 mt-12 max-w-3xl">
          Composição inicial-alvo documentada no regulamento do FIDC. Mix ajustado continuamente pelo gestor com base em condições de mercado.
        </p>
      </div>
    </section>
  );
}
