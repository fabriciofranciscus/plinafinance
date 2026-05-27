'use client';

import { useCallback, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type {
  BuyResult,
  FlowError,
  OnRampData,
  OnboardData,
  QuoteData,
  Screen,
  SwapBuild,
} from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseSwapArgs {
  onboard: OnboardData | null;
  quote: QuoteData | null;
  onRamp: OnRampData | null;
  signRawHash: ReturnType<typeof useSignRawHash>['signRawHash'];
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
  onNextScreen: (next: Screen) => void;
}

export function useSwap({
  onboard,
  quote,
  onRamp,
  signRawHash,
  getAccessToken,
  onError,
  clearError,
  onNextScreen,
}: UseSwapArgs) {
  const [swapBuild, setSwapBuild] = useState<SwapBuild | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [signConfirmed, setSignConfirmed] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyResult, setBuyResult] = useState<BuyResult | null>(null);

  // Build swap envelope (real) ou executa swap direto (mock).
  const goToConfirm = useCallback(async () => {
    if (!onboard || !quote || !onRamp) return;
    // PIX/BRL sandbox às vezes para em `processing` — se anchor já emitiu
    // CB, prossegue (claim move TESOURO pra trustline). Senão exige
    // `completed`.
    const onRampReady =
      onRamp.status === 'completed' ||
      (onRamp.status === 'processing' && !!onRamp.stellarClaimableBalanceId);
    if (!onRampReady) return;
    // PLINA-MOD-007: se anchor pagou TESOURO via ClaimableBalance e ainda
    // não foi claimed, desvia pro screen de resgate antes do swap.
    if (onRamp.stellarClaimableBalanceId && !onRamp.claimTxHash) {
      onNextScreen('claiming');
      return;
    }
    setSwapLoading(true);
    clearError();
    setSignConfirmed(false);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/swap/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          investorPubkey: onboard.publicKey,
          investidorId: onboard.investidorId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SwapBuild;
      setSwapBuild(data);
      if (data.mock) {
        // Mock: server já executou. Vai direto pro receipt.
        setBuyResult({
          swapTxHash: data.txHash,
          onRampTxHash: onRamp.stellarTxHash ?? null,
          mock: true,
        });
        onNextScreen('receipt');
      } else {
        onNextScreen('confirm');
      }
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setSwapLoading(false);
    }
  }, [onboard, quote, onRamp, getAccessToken, onError, clearError, onNextScreen]);

  const buy = useCallback(async () => {
    if (!onboard || !quote || !swapBuild || swapBuild.mock) return;
    clearError();
    setBuying(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: swapBuild.hashHex as `0x${string}`,
      });
      const submitRes = await fetch('/api/investidor/buy/swap/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          investorPubkey: onboard.publicKey,
          signatureHex: signature,
          xdr: swapBuild.xdr,
          distributorSigBase64: swapBuild.distributorSigBase64,
          distributorPubkey: swapBuild.distributorPubkey,
          investidorId: onboard.investidorId,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      const data = (await submitRes.json()) as { swapTxHash: string };
      setBuyResult({
        swapTxHash: data.swapTxHash,
        onRampTxHash: onRamp?.stellarTxHash ?? null,
        mock: false,
      });
      onNextScreen('receipt');
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setBuying(false);
    }
  }, [onboard, quote, swapBuild, onRamp, signRawHash, getAccessToken, onError, clearError, onNextScreen]);

  const reset = useCallback(() => {
    setBuyResult(null);
    setSwapBuild(null);
    setSignConfirmed(false);
  }, []);

  return {
    swapBuild,
    swapLoading,
    signConfirmed,
    setSignConfirmed,
    buying,
    buyResult,
    goToConfirm,
    buy,
    reset,
  };
}
