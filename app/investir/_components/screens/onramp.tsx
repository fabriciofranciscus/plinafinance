'use client';

import type { OnRampData, QuoteData } from '../../_types';
import { BRL } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';

export function OnRampScreen({
  onRamp,
  quote,
  paying,
  onSandboxPay,
  onSkipToSettling,
}: {
  onRamp: OnRampData;
  quote: QuoteData;
  paying: boolean;
  onSandboxPay: () => void;
  onSkipToSettling: () => void;
}) {
  const instructions = onRamp.paymentInstructions;
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        04 // Pagamento · <Term>onramp</Term> BRL → TESOURO
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {onRamp.mock
          ? 'Sandbox mock — pague simulado'
          : 'Pague via PIX para a anchor'}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {onRamp.mock ? (
          <>
            Bank account PIX não está ativa (PLINA-MOD-005 — exige iframe
            Etherfuse em produção). Em sandbox usamos um <em>mock</em>:
            simulamos o PIX como pago e flipamos a order pra <code>completed</code>.
          </>
        ) : (
          <>
            Pague o PIX abaixo do seu banco. A Etherfuse confirma o
            recebimento e paga TESOURO na sua wallet Stellar
            automaticamente (~10-30s após confirmação).
          </>
        )}
      </p>

      <div className="mt-10 border-y border-light-hairline">
        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Valor (BRL)"
            v={
              <span className="font-mono text-sm">
                {BRL.format(Number(quote.fromAmount))}
              </span>
            }
          />
          <DataRow
            k="Chave PIX"
            v={
              <span className="font-mono text-xs break-all">
                {instructions?.pixKey ?? instructions?.pixCode ?? '—'}
              </span>
            }
          />
          <DataRow
            k="Beneficiário"
            v={
              <span className="font-mono text-xs">
                {instructions?.beneficiary ?? 'Etherfuse Brasil'}
              </span>
            }
          />
          <DataRow
            k="Order ID"
            v={
              <span className="font-mono text-[11px] text-base/75">
                {onRamp.orderId}
              </span>
            }
          />
          <DataRow
            k="Status"
            v={
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/75">
                ○ {onRamp.status}
                {onRamp.mock && ' · mock'}
              </span>
            }
          />
        </dl>
      </div>

      <div className="mt-12 flex flex-wrap gap-4">
        {/* Em testnet (mock ou real), botão sandbox-pay funciona pra ambos:
            mock flippa direto pra completed; real chama simulateFiatReceived
            + polling no Etherfuse. Pra E2E e demos, sempre exposto. */}
        <button
          onClick={onSandboxPay}
          disabled={paying}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-3"
        >
          {paying && (
            <span
              className="w-2 h-2 bg-primary rounded-full animate-pulse"
              aria-hidden
            />
          )}
          {paying ? 'Simulando PIX…' : 'Simular PIX pago (sandbox)'}
        </button>
        {!onRamp.mock && (
          <button
            onClick={onSkipToSettling}
            className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200"
          >
            Já paguei · acompanhar liquidação
          </button>
        )}
      </div>
    </div>
  );
}
