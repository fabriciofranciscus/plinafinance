'use client';

import { useMemo, useState } from 'react';
import type { CotaResumo } from '../../_types';
import { BRL, TIPO_LABEL, valorRevenda } from '../../_lib/glossary';

const labelCls =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/60';

export function BuscarScreen({
  cotas,
  loading,
  onSelect,
}: {
  cotas: CotaResumo[] | null;
  loading: boolean;
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
            className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
            className="mt-2 w-full bg-white border border-light-hairline px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={0}>Qualquer</option>
            <option value={0.1}>10%+</option>
            <option value={0.15}>15%+</option>
            <option value={0.2}>20%+</option>
          </select>
        </label>
      </div>

      {/* Grid */}
      <div className="mt-8">
        {loading ? (
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
            Carregando cotas…
          </p>
        ) : filtradas.length === 0 ? (
          <p className="font-text text-sm text-base/70">
            Nenhuma cota disponível com esses filtros. Ajuste e tente de novo.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
            {filtradas.map((c) => (
              <CotaCard key={c.id} cota={c} onSelect={() => onSelect(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CotaCard({ cota, onSelect }: { cota: CotaResumo; onSelect: () => void }) {
  const paga = valorRevenda(cota.valorCarta, cota.desagioRevenda);
  const economia = cota.valorCarta - paga;
  const descontoPct = ((cota.desagioRevenda ?? 0) * 100).toFixed(1);

  return (
    <div className="bg-sheet-white p-5 flex flex-col">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
        {TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem}
        {cota.localizacaoAprox ? ` · ${cota.localizacaoAprox}` : ''}
      </p>
      <div className="mt-1 inline-flex items-center gap-1.5 self-start border border-primary-deep/30 bg-primary-deep/5 px-2 py-0.5 font-mono text-[10px] text-primary-deep">
        ✓ Validado juridicamente
      </div>

      <div className="mt-5">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50">
          Valor de face
        </p>
        <p className="font-mono text-lg text-base">{BRL.format(cota.valorCarta)}</p>
      </div>

      <div className="mt-3 border border-primary-deep/30 bg-primary-deep/5 p-3">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50">
          Você paga · −{descontoPct}%
        </p>
        <p className="font-mono text-2xl font-bold text-primary-deep">
          {BRL.format(paga)}
        </p>
        <p className="font-mono text-[11px] text-base/55 mt-1">
          poupa {BRL.format(economia)}
        </p>
      </div>

      {cota.prazoRestanteMeses != null && (
        <p className="mt-3 font-mono text-[11px] text-base/55">
          Prazo restante: {cota.prazoRestanteMeses}m
        </p>
      )}

      <button
        onClick={onSelect}
        className="mt-5 w-full bg-base text-white py-3 font-details text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors"
      >
        Selecionar cota →
      </button>
    </div>
  );
}
