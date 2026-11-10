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
import { postJson } from '@/lib/http/client';
import { attachInvestorSignature } from '../_lib/signed-xdr';
import { NavMudouError, submitSwap } from '../_lib/swap-submit';

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
  // 409 NAV_MUDOU no submit: a cotação ficou velha; a tela oferece recotar.
  const [navMudou, setNavMudou] = useState(false);

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
    setNavMudou(false);
    try {
      const data = await postJson<SwapBuild>(
        '/api/investidor/buy/swap/build',
        {
          quoteId: quote.quoteId,
          investorPubkey: onboard.publicKey,
          investidorId: onboard.investidorId,
        },
        getAccessToken,
      );
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
    setNavMudou(false);
    setBuying(true);
    try {
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: swapBuild.hashHex as `0x${string}`,
      });
      // N1: o investidor assina e manda só `{ quoteId, signedXdr }`. A Plina
      // (issuer) assina no submit, depois de validar o envelope; nada de
      // assinatura ou chave da Plina passa pelo cliente.
      const signedXdr = attachInvestorSignature(
        swapBuild.xdr,
        onboard.publicKey,
        signature,
      );
      const data = await submitSwap(
        { quoteId: quote.quoteId, signedXdr },
        getAccessToken,
      );
      setBuyResult({
        swapTxHash: data.swapTxHash,
        onRampTxHash: onRamp?.stellarTxHash ?? null,
        mock: false,
      });
      onNextScreen('receipt');
    } catch (err) {
      if (err instanceof NavMudouError) {
        setNavMudou(true);
      } else {
        onError(asFlowError(err));
      }
    } finally {
      setBuying(false);
    }
  }, [onboard, quote, swapBuild, onRamp, signRawHash, getAccessToken, onError, clearError, onNextScreen]);

  const reset = useCallback(() => {
    setBuyResult(null);
    setSwapBuild(null);
    setSignConfirmed(false);
    setNavMudou(false);
  }, []);

  // Recotar após NAV_MUDOU: refaz o build do swap (o servidor relê o NAV).
  // Não cria novo on-ramp: nenhum BRL novo é cobrado.
  const requote = useCallback(async () => {
    setNavMudou(false);
    await goToConfirm();
  }, [goToConfirm]);

  return {
    swapBuild,
    swapLoading,
    signConfirmed,
    setSignConfirmed,
    buying,
    buyResult,
    navMudou,
    requote,
    goToConfirm,
    buy,
    reset,
  };
}
