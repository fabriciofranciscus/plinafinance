/**
 * Concentração por administradora no /admin (A-23, Íris). Abaixo de md: uma coluna fluida (nome, depois valor e
 * participação lado a lado ou empilhados, depois o estado em TEXTO, sem cor como único sinal); de md em diante,
 * as quatro colunas de antes com o nome em minmax(0,1fr) para poder quebrar. Ordem do DOM fixa: nome → valor →
 * participação → estado. Só apresentação: o limiar e o cálculo (alerta > 40%) continuam no servidor da página.
 */

export interface ItemConcentracao {
  administradora: string;
  /** Valor já formatado em reais. */
  valor: string;
  /** Participação já formatada, ex.: "42,5%". */
  participacao: string;
  alerta: boolean;
}

export function Concentracao({ itens }: { itens: ItemConcentracao[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="mt-8 min-w-0 border border-light-hairline" data-testid="concentracao">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 px-4 py-3 border-b border-light-hairline">
        Concentração por administradora · alerta &gt; 40%
      </p>
      <ul className="divide-y divide-light-hairline">
        {itens.map((c) => (
          <li
            key={c.administradora}
            className="min-w-0 px-4 py-3 grid grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-[minmax(0,1fr)_120px_80px_100px] md:items-center md:gap-4"
          >
            <span className="min-w-0 font-text text-sm [overflow-wrap:anywhere]">{c.administradora}</span>
            <span className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 md:contents">
              <span className="font-mono text-xs md:text-right">
                <span className="md:hidden">Valor: </span>
                {c.valor}
              </span>
              <span className="font-mono text-xs md:text-right">
                <span className="md:hidden">Participação: </span>
                {c.participacao}
              </span>
            </span>
            <span
              className={`font-details text-[10px] tracking-[0.15em] uppercase text-left md:text-right ${
                c.alerta ? 'text-amber-700' : 'text-primary-deep'
              }`}
            >
              {c.alerta ? 'concentrado' : 'ok'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
