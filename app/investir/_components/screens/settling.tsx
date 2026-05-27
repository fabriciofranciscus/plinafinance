'use client';

import type { OnRampData, QuoteData } from '../../_types';
import { NUMBER_BR, explorerTx } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';

export function SettlingScreen({
  onRamp,
  quote,
  swapLoading,
  onContinue,
}: {
  onRamp: OnRampData;
  quote: QuoteData;
  swapLoading: boolean;
  onContinue: () => void;
}) {
  // PIX/BRL sandbox pode parar em `processing` (= funded upstream) sem
  // auto-completar. Se anchor emitiu CB, o claim já está disponível —
  // tratamos como "done" pra prosseguir.
  const done =
    onRamp.status === 'completed' ||
    (onRamp.status === 'processing' && !!onRamp.stellarClaimableBalanceId);
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        05 // Liquidação · TESOURO na sua wallet
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {done ? 'TESOURO liquidado — prossiga' : 'Aguardando settlement…'}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {done ? (
          <>
            A anchor pagou TESOURO na sua wallet. Próximo passo: assinar o
            envelope <Term>swap atômico</Term> que troca TESOURO por PLINA-RF
            on-chain numa única transação.
          </>
        ) : (
          <>
            A Etherfuse está indexando o pagamento. Polling a cada 3s.
            Indexing grace de ~12s antes de marcar falha.
          </>
        )}
      </p>

      <div className="mt-10 border-y border-light-hairline">
        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Order"
            v={
              <span className="font-mono text-[11px] text-base/75">
                {onRamp.orderId}
              </span>
            }
          />
          <DataRow
            k="Status"
            v={
              <span
                className={`font-details text-[10px] tracking-[0.2em] uppercase ${
                  done ? 'text-primary-deep' : 'text-base/70'
                }`}
              >
                {done ? '●' : '○'} {onRamp.status}
                {onRamp.mock && ' · mock'}
              </span>
            }
          />
          {onRamp.stellarTxHash && (
            <DataRow
              k="TESOURO tx"
              v={
                onRamp.stellarTxHash.startsWith('mock-') ? (
                  <span className="font-mono text-[11px] text-base/75">
                    {onRamp.stellarTxHash}
                  </span>
                ) : (
                  <a
                    href={explorerTx(onRamp.stellarTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-base hover:text-primary-deep underline decoration-base/25 underline-offset-4 break-all"
                  >
                    {onRamp.stellarTxHash}
                  </a>
                )
              }
            />
          )}
          <DataRow
            k="A receber"
            v={
              <span className="font-mono text-sm">
                {NUMBER_BR.format(Number(quote.toAmount))} PLINA-RF
              </span>
            }
          />
        </dl>
      </div>

      <div className="mt-12">
        <button
          onClick={onContinue}
          disabled={!done || swapLoading}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
        >
          {swapLoading && (
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
          )}
          {swapLoading
            ? 'Preparando envelope…'
            : done
              ? 'Continuar para revisão do swap'
              : 'Aguardando settlement…'}
        </button>
      </div>
    </div>
  );
}
