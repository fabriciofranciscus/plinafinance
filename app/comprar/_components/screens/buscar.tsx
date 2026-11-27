'use client';

import { useMemo, useState } from 'react';
import type { CotaResumo } from '../../_types';
import { BRL, TIPO_LABEL, valorRevenda } from '../../_lib/glossary';

const labelCls =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/65';

export function BuscarScreen({
  cotas,
  loading,
  falhou,
  erro,
  onSelect,
}: {
  cotas: CotaResumo[] | null;
  loading: boolean;
  /** A leitura da lista falhou: o erro ocupa o lugar da lista e a frase de filtro vazio não aparece. */
  falhou: boolean;
  erro?: React.ReactNode;
  onSelect: (cota: CotaResumo) => void;
}) {
  const [tipo, setTipo] = useState<string>('TODOS');
  const [descontoMin, setDescontoMin] = useState<number>(0);

  const filtradas = useMemo(() => {
    if (!cotas) return [];
    return cotas.filter((c) => {
      if (tipo !== 'TODOS' && c.tipoBem !== tipo) return false;
      if ((c.desagioRevenda ?? 0) < descontoMin) return false;
      return true;
    });
  }, [cotas, tipo, descontoMin]);

  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        01 // Buscar cota
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Cotas contempladas, com deságio real.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Validadas juridicamente pela Plina e com cessão registrada on-chain na
        Stellar. Filtre e selecione para avançar à due diligence.
      </p>

      {/* Filtros */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Tipo de bem</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary max-md:min-h-[44px]"
          >
            <option value="TODOS">Todos</option>
            {Object.keys(TIPO_LABEL).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Desconto mínimo</span>
          <select
            value={descontoMin}
            onChange={(e) => setDescontoMin(Number(e.target.value))}
            className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary max-md:min-h-[44px]"
          >
            <option value={0}>Qualquer</option>
            <option value={0.1}>10%+</option>
            <option value={0.15}>15%+</option>
            <option value={0.2}>20%+</option>
          </select>
        </label>
      </div>

      {/* Quatro saídas exclusivas: carregando · falha · filtro sem resultado · lista (AP-5 C3). */}
      <div className="mt-8">
        {falhou ? (
          erro ?? null
        ) : loading || cotas === null ? (
          <p role="status" className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 animate-pulse">
            Carregando cotas…
          </p>
        ) : filtradas.length === 0 ? (
          <p className="font-text text-sm text-base/70">
            Nenhuma cota disponível com esses filtros. Ajuste e tente de novo.
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
            {filtradas.map((c) => (
              <CotaCard key={c.id} cota={c} onSelect={() => onSelect(c)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CotaCard({ cota, onSelect }: { cota: CotaResumo; onSelect: () => void }) {
  const paga = valorRevenda(cota.valorCarta, cota.desagioRevenda);
  const descontoPct = ((cota.desagioRevenda ?? 0) * 100).toFixed(1);

  const idTipo = `cota-${cota.id}-tipo`;
  const idValor = `cota-${cota.id}-valor`;

  return (
    <li className="bg-sheet-white p-5 flex flex-col">
      <p id={idTipo} className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
        {TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem}
        {cota.localizacaoAprox ? ` · ${cota.localizacaoAprox}` : ''}
      </p>
      <div className="mt-1 inline-flex items-center gap-1.5 self-start border border-primary-deep/30 bg-primary-deep/5 px-2 py-0.5 font-mono text-[10px] text-primary-deep">
        ✓ Validado juridicamente
      </div>

      <div className="mt-5">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
          Valor de face
        </p>
        <p id={idValor} className="font-mono text-lg text-base">{BRL.format(cota.valorCarta)}</p>
      </div>

      <div className="mt-3 border border-primary-deep/30 bg-primary-deep/5 p-3">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
          Entrada (−{descontoPct}% sobre o valor de face)
        </p>
        <p className="font-mono text-2xl font-bold text-primary-deep">
          {BRL.format(paga)}
        </p>
        <p className="font-text text-[11px] text-base/65 mt-1 leading-snug">
          Valor de face {BRL.format(cota.valorCarta)}. Nesta fase, só são aceitas cotas quitadas (sem parcelas restantes).
        </p>
      </div>

      {cota.prazoRestanteMeses != null && (
        <p className="mt-3 font-mono text-[11px] text-base/65">
          Prazo restante: {cota.prazoRestanteMeses}m
        </p>
      )}

      <button
        onClick={onSelect}
        aria-describedby={`${idTipo} ${idValor}`}
        className="mt-5 w-full bg-base text-white py-3 font-details text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors max-md:min-h-[44px]"
      >
        Selecionar cota →
      </button>
    </li>
  );
}
