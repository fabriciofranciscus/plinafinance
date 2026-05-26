'use client';

import type { ClaimResult, OnRampData } from '../../_types';
import { explorerTx } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';

export function ClaimingScreen({
  onRamp,
  claimResult,
  claiming,
  swapLoading,
  onClaim,
  onContinue,
}: {
  onRamp: OnRampData;
  claimResult: ClaimResult | null;
  claiming: boolean;
  swapLoading: boolean;
  onClaim: () => void;
  onContinue: () => void;
}) {
  const claimed = !!(claimResult || onRamp.claimTxHash);
  const txHash = claimResult?.claimTxHash ?? onRamp.claimTxHash ?? null;
  return (
    <div>
      <TestnetBanner />
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        06 // Resgate · ClaimableBalance → trustline
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {claimed
          ? 'TESOURO na sua trustline — prossiga'
          : 'Assine pra resgatar o TESOURO emitido'}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        A Etherfuse emitiu TESOURO num <Term>ClaimableBalance</Term> Stellar
        (PLINA-MOD-007). Pra ele entrar na sua wallet, você precisa assinar
        um <Term>claimClaimableBalance</Term>. Sem isso, o swap atômico
        falha por saldo zero.
      </p>

      <div className="mt-10 border-y border-light-hairline">
        <dl className="grid grid-cols-1 gap-px bg-base/10">
          {onRamp.stellarClaimableBalanceId && (
            <DataRow
              k="CB id"
              v={
                <span className="font-mono text-[11px] text-base/75 break-all">
                  {onRamp.stellarClaimableBalanceId}
                </span>
              }
            />
          )}
          {txHash && (
            <DataRow
              k="Claim tx"
              v={
                <a
                  href={explorerTx(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-base hover:text-primary-deep underline decoration-base/25 underline-offset-4 break-all"
                >
                  {txHash}
                </a>
              }
            />
          )}
        </dl>
      </div>

      <div className="mt-12 flex gap-4">
        {!claimed && (
          <button
            onClick={onClaim}
            disabled={claiming}
            className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
          >
            {claiming && (
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
            )}
            {claiming ? 'Assinando claim…' : 'Assinar e reclamar TESOURO'}
          </button>
        )}
        {claimed && (
          <button
            onClick={onContinue}
            disabled={swapLoading}
            className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
          >
            {swapLoading && (
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
            )}
            {swapLoading ? 'Preparando envelope…' : 'Continuar para revisão'}
          </button>
        )}
      </div>
    </div>
  );
}
