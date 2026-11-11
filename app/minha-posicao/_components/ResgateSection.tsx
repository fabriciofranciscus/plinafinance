'use client';

import { useResgate, type UseResgateArgs } from '../_hooks/use-resgate';
import { RESGATE, SACAR } from '@/lib/sacar/microcopy';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 7 });

const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

/** Mostra um valor decimal do servidor sem recalcular nada (só formata). */
const fmt = (v: string, f: Intl.NumberFormat) => (Number.isFinite(Number(v)) ? f.format(Number(v)) : v);

/**
 * Resgate (E2-6): tokens de demonstração -> TESOURO, 1 transação com 2 pernas
 * (contrato E2-4). Passo 1 de 2; o passo 2 é o /sacar (TESOURO -> reais).
 */
export function ResgateSection({
  plinarfQty,
  ...args
}: { plinarfQty: number } & UseResgateArgs) {
  const r = useResgate(args);
  const ocupado = r.passo === 'building' || r.passo === 'signing' || r.passo === 'submitting';

  if (r.passo === 'done' && r.txHash) {
    return (
      <section className="mb-16" aria-labelledby="resgate-titulo">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
          {SACAR.passo.resgate}
        </p>
        <div className="border border-light-hairline p-6 md:p-8" role="status">
          <h2 id="resgate-titulo" className="font-title text-2xl font-semibold tracking-tight">
            {RESGATE.concluido.titulo}
          </h2>
          <p className="font-text text-sm text-base/80 mt-3 max-w-2xl leading-relaxed">
            {RESGATE.concluido.texto}
          </p>
          <p className="mt-4 font-mono text-xs break-all">
            {RESGATE.concluido.tx}:{' '}
            <a
              href={explorerTx(r.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-signal-700 hover:text-base"
            >
              {r.txHash}
            </a>
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <a
              href="/sacar"
              className="inline-flex items-center min-h-[48px] px-6 rounded-full bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase font-bold hover:bg-primary-deep transition-colors"
            >
              {RESGATE.concluido.proximo}
            </a>
            <button
              type="button"
              onClick={r.reset}
              className="inline-flex items-center min-h-[44px] font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4"
            >
              {RESGATE.concluido.novo}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-16" aria-labelledby="resgate-titulo">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
        {SACAR.passo.resgate}
      </p>
      <div className="border border-light-hairline p-6 md:p-8 space-y-5">
        <h2 id="resgate-titulo" className="font-title text-xl font-semibold tracking-tight">
          {RESGATE.eyebrow}
        </h2>
        <p className="font-text text-sm text-base/80 max-w-2xl leading-relaxed">{SACAR.resgate.aviso}</p>

        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <label className="block flex-1">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              {RESGATE.quantidade}
            </span>
            <div className="flex gap-2 mt-2">
              <input
                type="number"
                min="1"
                max={plinarfQty}
                step="1"
                inputMode="numeric"
                value={r.amount}
                disabled={ocupado}
                onChange={(e) => r.setAmount(e.target.value)}
                placeholder={`Máx. ${fmt(String(plinarfQty), NUM)}`}
                className="flex-1 min-h-[44px] bg-white border border-base/55 px-3 py-2 font-mono tabular-nums text-sm"
              />
              <button
                type="button"
                disabled={ocupado}
                onClick={() => r.setAmount(String(Math.floor(plinarfQty)))}
                className="min-h-[44px] min-w-[44px] font-details text-[10px] tracking-[0.2em] uppercase border border-base/55 px-3 hover:bg-base hover:text-lightBg disabled:opacity-40"
              >
                {RESGATE.maximo}
              </button>
            </div>
          </label>
          <button
            type="button"
            onClick={r.gerarCotacao}
            disabled={!r.amount || Number(r.amount) <= 0 || Number(r.amount) > plinarfQty || ocupado}
            className="min-h-[48px] rounded-full bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase font-bold px-6 hover:bg-primary-deep transition-colors disabled:opacity-40"
          >
            {r.passo === 'building' ? RESGATE.gerando : RESGATE.gerar}
          </button>
        </div>

        {r.build && (
          <>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
              <div className="bg-lightBg px-5 py-5">
                <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">{RESGATE.entrega}</dt>
                <dd className="font-mono tabular-nums text-xl mt-2">{fmt(r.build.amountPlinarf, NUM)}</dd>
              </div>
              <div className="bg-lightBg px-5 py-5">
                <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">{RESGATE.valorPorToken}</dt>
                <dd className="font-mono tabular-nums text-xl mt-2">{fmt(r.build.navPorTokenNaCotacao, BRL)}</dd>
              </div>
              <div className="bg-lightBg px-5 py-5">
                <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">{RESGATE.estimado}</dt>
                <dd className="font-mono tabular-nums text-xl mt-2">{fmt(r.build.brlEquivalente, BRL)}</dd>
              </div>
            </dl>
            <p className="font-text text-xs text-base/70">
              {RESGATE.avisoCotacao} {RESGATE.validaAte}{' '}
              <span className="font-mono">
                {new Date(r.build.expiresAt).toLocaleTimeString('pt-BR', { hour12: false })}
              </span>
              .
            </p>
            <div className="flex flex-wrap gap-3 pt-2 border-t border-light-hairline">
              <button
                type="button"
                onClick={r.confirmar}
                disabled={ocupado}
                className="min-h-[48px] rounded-full bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase font-bold px-6 hover:bg-primary-deep transition-colors disabled:opacity-50"
              >
                {r.passo === 'signing' ? RESGATE.assinando : r.passo === 'submitting' ? RESGATE.enviando : RESGATE.confirmar}
              </button>
              <button
                type="button"
                onClick={r.reset}
                disabled={ocupado}
                className="min-h-[44px] px-4 font-details text-[10px] tracking-[0.2em] uppercase border border-base/55 hover:bg-base hover:text-lightBg disabled:opacity-40"
              >
                {RESGATE.cancelar}
              </button>
            </div>
          </>
        )}

        <a
          href="/sacar"
          className="inline-flex items-center min-h-[44px] font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-base/80 hover:text-base"
        >
          {RESGATE.jaTemTesouro}
        </a>

        {r.erro && (
          <div role="alert" className="border border-red-300 bg-red-50 p-4">
            <p className="font-text text-sm text-red-900">{RESGATE.erro[r.erro.tipo]}</p>
            {r.erro.codigo && (
              <details className="mt-2">
                <summary className="min-h-[44px] flex items-center cursor-pointer font-details text-[10px] tracking-[0.2em] uppercase text-red-900/80">
                  {RESGATE.detalhesResumo}
                </summary>
                <p className="font-mono text-[11px] text-red-900/80">
                  {RESGATE.codigo}: {r.erro.codigo}
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
