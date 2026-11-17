'use client';

import Link from 'next/link';
import type { OnRampData, QuoteData } from '../../_types';
import { NUMBER_BR, explorerTx } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';
import { tokensDaCotacao } from '../../_lib/quote-tokens';
import { TEXTO_LIQUIDACAO, mailtoEquipe } from '../../_lib/texto-liquidacao';
import { useDecorrido } from '../shared/use-decorrido';

export function SettlingScreen({
  onRamp,
  quote,
  swapLoading,
  onContinue,
  onAtualizar,
  atualizando = false,
}: {
  onRamp: OnRampData;
  quote: QuoteData;
  swapLoading: boolean;
  onContinue: () => void;
  /** U2 A-09: consulta o status já (sem esperar o próximo tick). */
  onAtualizar?: () => void;
  atualizando?: boolean;
}) {
  // PIX/BRL sandbox pode parar em `processing` (= funded upstream) sem
  // auto-completar. Se anchor emitiu CB, o claim já está disponível —
  // tratamos como "done" pra prosseguir.
  const done =
    onRamp.status === 'completed' ||
    (onRamp.status === 'processing' && !!onRamp.stellarClaimableBalanceId);
  // U2 A-09: o servidor decide quando a espera passou do limite (processing sem claimable há mais de 180 s). Se a ordem já
  // andou (`done`), o aviso de atraso some sozinho.
  const atrasada = !done && onRamp.atrasada === true;
  const decorrido = useDecorrido(!done ? onRamp.desde : null);
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        05 // Liquidação · TESOURO na sua wallet
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {done ? 'TESOURO liquidado — prossiga' : atrasada ? TEXTO_LIQUIDACAO.atrasada.titulo : TEXTO_LIQUIDACAO.espera.titulo}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {done ? (
          <>
            A anchor pagou TESOURO na sua wallet. Próximo passo: assinar o
            envelope <Term>swap atômico</Term> que troca TESOURO por PLINA-RF
            on-chain numa única transação.
          </>
        ) : (
          (atrasada ? TEXTO_LIQUIDACAO.atrasada.texto : TEXTO_LIQUIDACAO.espera.texto)
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
          {!done && decorrido && (
            <DataRow
              k={TEXTO_LIQUIDACAO.espera.rotuloTempo}
              v={
                <span data-testid="tempo-de-espera" className="font-mono text-sm">
                  {decorrido}
                </span>
              }
            />
          )}
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
                {NUMBER_BR.format(Number(tokensDaCotacao(quote)))} PLINA-RF
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
              : TEXTO_LIQUIDACAO.espera.botaoAguardando}
        </button>
        {atrasada && (
          <div className="mt-8 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-8" data-testid="saidas-atraso">
            <button
              type="button"
              onClick={onAtualizar}
              disabled={atualizando || !onAtualizar}
              className="inline-flex min-h-[44px] items-center justify-center border border-base text-base font-details text-[10px] tracking-[0.2em] uppercase px-5 py-3 hover:bg-base hover:text-white transition-colors disabled:opacity-50"
            >
              {atualizando ? TEXTO_LIQUIDACAO.atrasada.botaoAtualizando : TEXTO_LIQUIDACAO.atrasada.botaoAtualizar}
            </button>
            <Link
              href="/inicio"
              className="inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-primary-deep hover:text-primary"
            >
              {TEXTO_LIQUIDACAO.atrasada.voltar}
            </Link>
            <a
              href={mailtoEquipe(onRamp.orderId)}
              className="inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-primary-deep hover:text-primary"
            >
              {TEXTO_LIQUIDACAO.atrasada.equipe}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
