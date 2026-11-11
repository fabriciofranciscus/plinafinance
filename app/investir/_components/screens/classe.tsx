'use client';

/**
 * F-M3-4 — Seletor de classe PLINA-RF (Sênior vs Subordinada).
 *
 * O investidor escolhe a classe antes do quote. Decisão thread-safe via
 * use-investir-flow → /api/investidor/quote (campo `classe`) → swap build/submit
 * picka o asset code (PLINARF Sênior / PLINARFB Subordinada).
 *
 * Disclaimer obrigatório: simulação em rede de testes, sem oferta nem promessa
 * de retorno. A tela não exibe meta de retorno de nenhuma subclasse.
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
  posicaoWaterfall: string;
  risco: string;
  descricao: string;
}> = [
  {
    id: 'SENIOR',
    titulo: 'Sênior · PLINARF',
    posicaoWaterfall: '1ª camada após despesas',
    risco: 'Menor',
    descricao:
      'Tem prioridade sobre a Subordinada nos pagamentos. Perdas atingem primeiro a Subordinada.',
  },
  {
    id: 'SUBORDINADA',
    titulo: 'Subordinada · PLINARFB',
    posicaoWaterfall: 'Última camada',
    risco: 'Maior',
    descricao:
      'Recebe depois da Sênior. É a primeira a absorver perdas.',
  },
];

export function ClasseScreen({ initial = 'SENIOR', onContinue }: ClasseScreenProps) {
  const [selected, setSelected] = useState<ClasseEscolhida>(initial);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        03 // Subclasse · PLINA-RF
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Escolha a subclasse (simulação em rede de testes).
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        O modelo prevê duas subclasses, Sênior e Subordinada, com ordens
        diferentes de recebimento e de absorção de perdas. A escolha define o
        asset code emitido na sua wallet de teste.
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
                  <dt className="text-base/55">Waterfall</dt>
                  <dd className="text-base text-right">{opt.posicaoWaterfall}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-base/55">Risco relativo</dt>
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
        Simulação em rede de testes, sem valor financeiro real. Esta tela não é
        oferta nem promessa de retorno ou de rentabilidade; uma estrutura
        institucional é fase futura, sujeita a aprovação regulatória.
        Whitepaper §6.5 · 4 hipóteses de clawback institucional aplicáveis a
        ambas as subclasses.
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
