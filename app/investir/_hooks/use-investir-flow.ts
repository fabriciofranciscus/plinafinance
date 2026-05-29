'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  useAppPrivy as usePrivy,
  useAppSignRawHash as useSignRawHash,
} from '@/lib/hooks/privy';
import type { ClasseEscolhida, FlowError, Screen } from '../_types';
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
  // F-M3-4. Default SENIOR — preserva o fluxo single-asset legado se o
  // usuário não passar pelo seletor (ex.: testes que pulam direto pra quote).
  const [classe, setClasse] = useState<ClasseEscolhida>('SENIOR');

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

  const onRegisteredBank = useCallback(() => setScreen('classe'), []);
  const bankingHook = useBanking({
    onboard,
    getAccessToken,
    onError,
    clearError,
    onRegistered: onRegisteredBank,
  });

  const quoteHook = useQuote({
    onboard,
    classe,
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
    setScreen(bankingHook.bankInfo ? 'classe' : 'banking');
  }, [bankingHook.bankInfo]);

  const onClasseContinue = useCallback(
    (chosen: ClasseEscolhida) => {
      setClasse(chosen);
      setScreen('quote');
    },
    [],
  );

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

  const skipBanking = useCallback(() => setScreen('classe'), []);

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
    onClasseContinue,
    classe,
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
