'use client';

import type { BuyResult, OnboardData, QuoteData } from '../../_types';
import { NUMBER_BR, explorerAccount } from '../../_lib/format';
import { TxRow } from '../shared/tx-row';

export function ReceiptScreen({
  onboard,
  quote,
  buyResult,
  onBuyMore,
}: {
  onboard: OnboardData;
  quote: QuoteData;
  buyResult: BuyResult;
  onBuyMore: () => void;
}) {
  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-deep mr-2 align-middle" aria-hidden />
        07 // {buyResult.mock ? 'Distribuição (mock sandbox) concluída' : 'Swap atômico concluído'}
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold mt-4 tracking-tight leading-[1.05] text-base">
        {NUMBER_BR.format(Number(quote.toAmount))}
        <span className="font-mono text-2xl md:text-3xl text-base/55 ml-3">PLINA-RF</span>
      </h1>
      <p className="font-text text-base mt-6 text-base/80 leading-relaxed max-w-prose">
        Na sua wallet Stellar institucional. Lastreado em direito creditório
        brasileiro sob CVM 175.{' '}
        {buyResult.mock
          ? 'Sandbox sem PIX real: distribuição direta server-side (PLINA-MOD-005 bypass).'
          : 'Swap atômico — 2 legs commitam juntas, settlement on-chain real.'}
      </p>

      <div className="mt-14">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mb-4">
          Transações on-chain
        </p>
        <ol className="space-y-px bg-base/10 border-y border-light-hairline">
          {buyResult.onRampTxHash && (
            <TxRow
              label={buyResult.mock ? 'onramp (mock)' : 'onramp · TESOURO'}
              hash={buyResult.onRampTxHash}
              idx={1}
            />
          )}
          <TxRow
            label={buyResult.mock ? 'distribute' : 'swap atômico'}
            hash={buyResult.swapTxHash}
            idx={buyResult.onRampTxHash ? 2 : 1}
          />
        </ol>
        <p className="font-mono text-[10px] text-base/55 mt-3">
          {buyResult.mock
            ? 'mock sandbox · sem TESOURO on-chain'
            : 'investidor assinou envelope · distributor co-assinou · 2 legs em 1 tx'}
        </p>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3">
        <a
          href="/minha-posicao"
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200"
        >
          Minha posição
        </a>
        <a
          href={explorerAccount(onboard.publicKey)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base transition-colors"
        >
          Ver no Stellar Expert →
        </a>
      </div>

      <div className="mt-16 pt-8 border-t border-light-hairline flex flex-wrap items-center gap-x-8 gap-y-3">
        <button
          onClick={onBuyMore}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors"
        >
          Comprar mais
        </button>
        <a
          href="/pool"
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors"
        >
          Pool atualizado →
        </a>
      </div>
    </div>
  );
}
