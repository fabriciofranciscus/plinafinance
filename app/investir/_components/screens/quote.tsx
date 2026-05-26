'use client';

import type { QuoteData } from '../../_types';
import { BRL, NUMBER_BR } from '../../_lib/format';
import { QUOTE_PRESETS } from '../../_lib/glossary';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { QuoteCell } from '../shared/quote-cell';
import { useExpiresIn } from '../shared/use-expires-in';

export function QuoteScreen({
  amountBrl,
  setAmountBrl,
  quote,
  loading,
  buildLoading,
  onContinue,
}: {
  amountBrl: string;
  setAmountBrl: (v: string) => void;
  quote: QuoteData | null;
  loading: boolean;
  buildLoading: boolean;
  onContinue: () => void;
}) {
  const expiresIn = useExpiresIn(quote?.expiresAt);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        03 // Cotação · BRL → PLINA-RF
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Quote ao vivo na anchor regulada.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Consulta real à Etherfuse. No POC, paridade 1:1 entre <Term>TESOURO</Term>{' '}
        (bridge intermediário) e PLINA-RF. Em produção, o PIX é concluído
        neste passo via iframe da anchor.
      </p>

      <div className="mt-12">
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Valor BRL
          </span>
          <div className="mt-3 flex items-baseline gap-4 border-b border-base pb-3">
            <span className="font-mono text-2xl text-base/45">R$</span>
            <input
              type="number"
              min="10"
              max="430"
              step="10"
              value={amountBrl}
              onChange={(e) => setAmountBrl(e.target.value)}
              className="flex-1 bg-transparent font-mono text-4xl md:text-5xl text-base font-medium focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Valor em reais"
            />
            {loading && (
              <span
                className="w-1.5 h-1.5 bg-primary-deep rounded-full animate-pulse"
                aria-label="Atualizando quote"
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-base/55 mt-2 inline-block">
            sandbox · máx R$ 430
          </span>
        </label>

        <div className="mt-6 flex flex-wrap gap-2">
          {QUOTE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmountBrl(p)}
              className={`font-mono text-xs px-4 py-2 rounded-full border transition-colors ${
                amountBrl === p
                  ? 'bg-base text-white border-base'
                  : 'bg-white text-base border-base/20 hover:border-base'
              }`}
            >
              R$ {p}
            </button>
          ))}
        </div>

        {quote && (
          <div className="mt-12">
            <div className="flex items-baseline justify-between mb-4">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
                Breakdown
              </p>
              {expiresIn && (
                <p className="font-mono text-[11px] text-base/65">
                  expira em <span className="text-base">{expiresIn}</span>
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-px bg-base/10 border-y border-light-hairline">
              <QuoteCell label="Você paga" value={BRL.format(Number(quote.fromAmount))} />
              <QuoteCell
                label="PLINA-RF (paridade POC)"
                value={NUMBER_BR.format(Number(quote.toAmount))}
                accent
              />
              <QuoteCell
                label="Câmbio"
                value={NUMBER_BR.format(Number(quote.exchangeRate))}
              />
              <QuoteCell label="Fee" value={BRL.format(Number(quote.fee))} />
            </dl>
            <p className="font-mono text-[10px] text-base/55 mt-3">
              em produção, swap real <Term>TESOURO</Term> → PLINA-RF via distributor Plina
            </p>

            <div className="mt-12">
              <button
                onClick={onContinue}
                disabled={buildLoading || loading}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-3"
              >
                {buildLoading && (
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
                )}
                {buildLoading ? 'Preparando transação…' : 'Revisar compra'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
