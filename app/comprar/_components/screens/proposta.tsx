'use client';

import { useState } from 'react';
import type { CotaResumo } from '../../_types';
import { BRL, TIPO_LABEL, valorRevenda } from '../../_lib/glossary';

export function PropostaScreen({
  cota,
  loading,
  onAceitar,
}: {
  cota: CotaResumo | null;
  loading: boolean;
  onAceitar: () => void;
}) {
  const [aceito, setAceito] = useState(false);
  if (!cota) return null;

  const paga = valorRevenda(cota.valorCarta, cota.desagioRevenda);
  const desconto = cota.valorCarta - paga;
  const descontoPct = ((cota.desagioRevenda ?? 0) * 100).toFixed(1);

  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        03 // Proposta &amp; negociação
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Revise os termos antes de reservar.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Ao aceitar, a cota é reservada por 72h em seu nome enquanto você conclui
        a cessão. A reserva é registrada on-chain.
      </p>

      <div className="mt-8 border border-light-hairline">
        <Row k="Cota" v={`${TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem}${cota.localizacaoAprox ? ` · ${cota.localizacaoAprox}` : ''}`} />
        <Row k="Valor de face" v={BRL.format(cota.valorCarta)} />
        <Row k="Desconto Plina" v={`− ${BRL.format(desconto)} (${descontoPct}%)`} accent />
        <Row k="Valor a pagar" v={BRL.format(paga)} big />
        <Row k="Forma de pagamento" v="TED / Pix / financiamento próprio" />
        <Row k="Validade da reserva" v="72 horas" />
      </div>

      <p className="mt-4 font-mono text-xs text-base/60 max-w-prose leading-relaxed">
        O desconto reflete o deságio original pago ao cotista mais a margem
        operacional da Plina. Você adquire uma cota com carta de crédito já
        disponível na administradora.
      </p>

      <label className="mt-6 flex items-start gap-3 font-text text-sm text-base/85 cursor-pointer">
        <input
          type="checkbox"
          checked={aceito}
          onChange={(e) => setAceito(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-primary-deep)]"
        />
        Li e compreendi as condições da cessão de direitos creditórios.
      </label>

      <button
        onClick={onAceitar}
        disabled={!aceito || loading}
        className="mt-8 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Reservando…' : 'Aceitar proposta e reservar →'}
      </button>
    </div>
  );
}

function Row({
  k,
  v,
  accent,
  big,
}: {
  k: string;
  v: string;
  accent?: boolean;
  big?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-light-hairline last:border-b-0">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
        {k}
      </span>
      <span
        className={
          big
            ? 'font-mono text-2xl font-bold text-primary-deep'
            : accent
              ? 'font-mono text-sm text-primary-deep'
              : 'font-text text-sm text-base'
        }
      >
        {v}
      </span>
    </div>
  );
}
