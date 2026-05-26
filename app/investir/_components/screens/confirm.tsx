'use client';

import { useState } from 'react';
import type { OnboardData, QuoteData, SwapEnvelope } from '../../_types';
import { BRL, NUMBER_BR, maskPubkey } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';

export function ConfirmScreen({
  onboard,
  quote,
  swap,
  signConfirmed,
  setSignConfirmed,
  buying,
  onConfirm,
}: {
  onboard: OnboardData;
  quote: QuoteData;
  swap: SwapEnvelope;
  signConfirmed: boolean;
  setSignConfirmed: (v: boolean) => void;
  buying: boolean;
  onConfirm: () => void;
}) {
  const [showXdr, setShowXdr] = useState(false);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        06 // Revisão · swap atômico
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Inspecione antes de assinar.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Você assina um envelope <Term>swap atômico</Term> com 2 legs: você
        paga TESOURO ao distributor, distributor te paga PLINA-RF. As duas
        operações commitam juntas — sem TESOURO, sem PLINA-RF. Distributor já
        co-assinou server-side.
      </p>

      <div className="mt-12 border-t border-light-hairline">
        <div className="py-8 border-b border-light-hairline">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
            Você receberá
          </p>
          <p className="font-mono text-5xl md:text-6xl mt-4 text-base font-medium tracking-tight">
            {NUMBER_BR.format(Number(quote.toAmount))}
            <span className="font-mono text-2xl md:text-3xl text-base/45 ml-3">PLINA-RF</span>
          </p>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mt-3">
            <Term>paridade NAV</Term> · 1 PLINA-RF = 1 BRL · POC
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Você paga (BRL)"
            v={<span className="font-mono text-sm">{BRL.format(Number(quote.fromAmount))}</span>}
          />
          <DataRow
            k="Wallet destino"
            v={
              <span className="font-mono text-xs" title={onboard.publicKey}>
                {maskPubkey(onboard.publicKey)}
              </span>
            }
          />
          <DataRow
            k="Distributor"
            v={
              <span className="font-mono text-xs" title={swap.distributorPubkey}>
                {maskPubkey(swap.distributorPubkey)} · co-assinado
              </span>
            }
          />
          <DataRow
            k="Hash a assinar"
            v={
              <span className="font-mono text-[11px] break-all text-base/75">
                {swap.hashHex}
              </span>
            }
          />
          <DataRow
            k="Operações on-chain"
            v={
              <span className="font-mono text-xs text-base/75">
                payment TESOURO · payment PLINA-RF (atômico)
              </span>
            }
          />
          <DataRow
            k="Cláusula clawback"
            v={
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/75">
                <Term>clawback</Term> · hipóteses §6.5
              </span>
            }
          />
        </dl>

        <div className="border-y border-light-hairline">
          <button
            type="button"
            onClick={() => setShowXdr((v) => !v)}
            className="w-full text-left px-1 py-4 flex items-center justify-between hover:bg-lightBg/40 transition-colors"
            aria-expanded={showXdr}
          >
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
              {showXdr ? '— Ocultar XDR' : '+ Inspecionar XDR completo'}
            </span>
            <span className="font-mono text-[10px] text-base/55">
              base64 · stellar envelope
            </span>
          </button>
          {showXdr && (
            <pre className="bg-lightBg/60 border-t border-light-hairline px-4 py-4 font-mono text-[10px] text-base/75 whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {swap.xdr}
            </pre>
          )}
        </div>
      </div>

      <label className="mt-10 flex items-start gap-4 cursor-pointer group">
        <span
          className={`mt-0.5 w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors ${
            signConfirmed ? 'bg-base border-base' : 'bg-white border-base/40 group-hover:border-base'
          }`}
          aria-hidden
        >
          {signConfirmed && (
            <span className="font-mono text-xs text-white leading-none">✓</span>
          )}
        </span>
        <span className="font-text text-sm text-base/85 leading-relaxed">
          <input
            type="checkbox"
            checked={signConfirmed}
            onChange={(e) => setSignConfirmed(e.target.checked)}
            className="sr-only"
            aria-label="Confirmo destinatário e hash"
          />
          Revisei o destinatário{' '}
          <span className="font-mono text-xs text-base">{maskPubkey(onboard.publicKey)}</span>,
          o asset PLINA-RF e o hash da transação. Estou ciente de que esta é uma operação
          em testnet sem valor financeiro real.
        </span>
      </label>

      <div className="mt-10">
        <button
          onClick={onConfirm}
          disabled={buying || !signConfirmed}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-10 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
        >
          {buying ? (
            <span className="inline-flex items-center gap-3">
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
              Submetendo swap atômico…
            </span>
          ) : (
            'Assinar e executar swap'
          )}
        </button>
        {!buying && (
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-4">
            Pop-up Privy vai pedir confirmação da assinatura
          </p>
        )}
      </div>
    </div>
  );
}
