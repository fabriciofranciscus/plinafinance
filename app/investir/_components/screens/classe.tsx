'use client';

/**
 * F-M3-4 — Seletor de classe PLINA-RF (Sênior vs Subordinada).
 *
 * O investidor escolhe a classe antes do quote. Decisão thread-safe via
 * use-investir-flow → /api/investidor/quote (campo `classe`) → swap build/submit
 * picka o asset code (PLINARF Sênior / PLINARFB Subordinada).
 *
 * Disclaimer obrigatório "sem promessa de rentabilidade" — números de yield
 * são indicativos do mockup (PRD §M5.1), não compromisso contratual.
 */

import { useState } from 'react';
import type { ClasseEscolhida } from '../../_types';
import { TestnetBanner } from '../shell/testnet-banner';

interface ClasseScreenProps {
  initial?: ClasseEscolhida;
  onContinue: (classe: ClasseEscolhida) => void;
}

const OPCOES: Array<{
  id: ClasseEscolhida;
  titulo: string;
  yieldAlvo: string;
  posicaoWaterfall: string;
  risco: string;
  descricao: string;
}> = [
  {
    id: 'SENIOR',
    titulo: 'Sênior · PLINARF',
    yieldAlvo: 'CDI + x%',
    posicaoWaterfall: '1ª camada após despesas',
    risco: 'Menor',
    descricao:
      'Recebe yield prometido antes da camada Subordinada. Inadimplência é absorvida primeiro pela Subordinada — só atinge Sênior em estresse severo. Padrão institucional brasileiro.',
  },
  {
    id: 'SUBORDINADA',
    titulo: 'Subordinada · PLINARFB',
    yieldAlvo: 'Sobra residual',
    posicaoWaterfall: 'Última camada (skin-in-the-game)',
    risco: 'Maior',
    descricao:
      'Recebe a sobra após despesas e yield Sênior. Primeira camada a absorver inadimplência. Compartilhada com Plina como skin-in-the-game — alinhamento de incentivos.',
  },
];

export function ClasseScreen({ initial = 'SENIOR', onContinue }: ClasseScreenProps) {
  const [selected, setSelected] = useState<ClasseEscolhida>(initial);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        03 // Classe · PLINA-RF
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Escolha sua classe no FIDC.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        O PLINA-RF é estruturado em duas classes com tratamento distinto no
        waterfall. A escolha define o asset code emitido na sua wallet e a
        ordem de recebimento de yield e absorção de perdas.
      </p>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">
        {OPCOES.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelected(opt.id)}
              className={`text-left border p-6 transition-colors ${
                active
                  ? 'border-primary-deep bg-primary-deep/5'
                  : 'border-light-hairline hover:border-base/40'
              }`}
              aria-pressed={active}
            >
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55">
                {active ? '● selecionado' : 'selecionar'}
              </p>
              <h2 className="font-title text-xl font-semibold mt-2 text-base">
                {opt.titulo}
              </h2>

              <dl className="mt-5 space-y-2 font-text text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-base/55">Yield alvo</dt>
                  <dd className="font-mono text-base text-right">{opt.yieldAlvo}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-base/55">Waterfall</dt>
                  <dd className="text-base text-right">{opt.posicaoWaterfall}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-base/55">Risco</dt>
                  <dd className="text-base text-right">{opt.risco}</dd>
                </div>
              </dl>

              <p className="font-text text-sm text-base/75 mt-5 leading-relaxed">
                {opt.descricao}
              </p>
            </button>
          );
        })}
      </div>

      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-10 max-w-prose leading-relaxed">
        Disclaimer · yield-alvo é indicativo e não representa promessa de
        rentabilidade. Whitepaper §6.5 · 4 hipóteses de clawback institucional
        aplicáveis a ambas as classes.
      </p>

      <div className="mt-10">
        <button
          type="button"
          onClick={() => onContinue(selected)}
          className="font-details text-[10px] tracking-[0.2em] uppercase bg-primary-deep text-white px-8 py-4 hover:bg-primary-deep/90 transition-colors"
        >
          Continuar com {selected === 'SENIOR' ? 'Sênior' : 'Subordinada'} →
        </button>
      </div>
    </div>
  );
}
