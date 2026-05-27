'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  useAppPrivy as usePrivy,
  useAppSignRawHash as useSignRawHash,
} from '@/lib/hooks/privy';
import type { FlowError, Screen } from '../_types';
import { SCREENS } from '../_lib/glossary';
import { useOnboard } from './use-onboard';
import { useTrustlines } from './use-trustlines';
import { useBanking } from './use-banking';
import { useQuote } from './use-quote';
import { useOnRamp } from './use-onramp';
import { useClaim } from './use-claim';
import { useSwap } from './use-swap';

export function useInvestirFlow() {
  const privy = usePrivy();
  const { signRawHash } = useSignRawHash();
  const { ready, authenticated, getAccessToken } = privy;

  const [screen, setScreen] = useState<Screen>('welcome');
  const [error, setError] = useState<FlowError | null>(null);
  const [kycConsented, setKycConsented] = useState(false);
  const [onRampLoading, setOnRampLoading] = useState(false);

  const onError = useCallback((e: FlowError) => setError(e), []);
  const clearError = useCallback(() => setError(null), []);
  const dismissError = clearError;

  const onboardHook = useOnboard({ getAccessToken, onError, clearError });
  const { onboard } = onboardHook;

  const trustlinesHook = useTrustlines({
    onboard,
    signRawHash,
    getAccessToken,
    onError,
    clearError,
  });

  const onRegisteredBank = useCallback(() => setScreen('quote'), []);
  const bankingHook = useBanking({
    onboard,
    getAccessToken,
    onError,
    clearError,
    onRegistered: onRegisteredBank,
  });

  const quoteHook = useQuote({
    onboard,
    screen,
    onRampLoading,
    getAccessToken,
    onError,
    clearError,
  });

  const onOnrampCreated = useCallback(() => setScreen('onramp'), []);
  const onSandboxPaid = useCallback(() => setScreen('settling'), []);
  const onRampHook = useOnRamp({
    quote: quoteHook.quote,
    screen,
    getAccessToken,
    onError,
    clearError,
    onCreated: onOnrampCreated,
    onSandboxPaid,
    setOnRampLoading,
    onRampLoading,
  });

  const claimHook = useClaim({
    onboard,
    onRamp: onRampHook.onRamp,
    signRawHash,
    getAccessToken,
    onError,
    clearError,
    onClaimed: onRampHook.applyClaimTxHash,
  });

  const onNextScreen = useCallback((next: Screen) => setScreen(next), []);
  const swapHook = useSwap({
    onboard,
    quote: quoteHook.quote,
    onRamp: onRampHook.onRamp,
    signRawHash,
    getAccessToken,
    onError,
    clearError,
    onNextScreen,
  });

  // Auto-transição welcome → identity quando Privy autentica.
  useEffect(() => {
    if (ready && authenticated && screen === 'welcome') {
      setScreen('identity');
    }
  }, [ready, authenticated, screen]);

  const goBack = useCallback(() => {
    const currentIdx = SCREENS.findIndex((s) => s.id === screen);
    const prev = SCREENS[Math.max(0, currentIdx - 1)];
    if (prev) setScreen(prev.id);
  }, [screen]);

  const onIdentityContinue = useCallback(() => {
    setScreen(bankingHook.bankInfo ? 'quote' : 'banking');
  }, [bankingHook.bankInfo]);

  const onBuyMore = useCallback(() => {
    swapHook.reset();
    onRampHook.resetOnRamp();
    quoteHook.resetQuote();
    setScreen('quote');
  }, [swapHook, onRampHook, quoteHook]);

  const consentAndOnboard = useCallback(() => {
    setKycConsented(true);
    void onboardHook.runOnboard();
  }, [onboardHook]);

  const skipBanking = useCallback(() => setScreen('quote'), []);

  return {
    privy,
    screen,
    setScreen,
    goBack,
    error,
    dismissError,
    kycConsented,
    consentAndOnboard,
    onIdentityContinue,
    onBuyMore,
    skipBanking,
    onboard: onboardHook,
    trustlines: trustlinesHook,
    banking: bankingHook,
    quote: quoteHook,
    onRamp: onRampHook,
    claim: claimHook,
    swap: swapHook,
  };
}
