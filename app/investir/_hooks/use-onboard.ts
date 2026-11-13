'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowError, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';

export interface UseOnboardArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export const KYC_POLL_MS = 5_000;
export const KYC_POLL_MAX = 60;

export function useOnboard({ getAccessToken, onError, clearError }: UseOnboardArgs) {
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  const runOnboard = useCallback(async () => {
    clearError();
    setOnboarding(true);
    try {
      const data = await postJson<OnboardData>(
        '/api/investidor/onboard',
        {},
        getAccessToken,
      );
      setOnboard(data);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setOnboarding(false);
    }
  }, [getAccessToken, onError, clearError]);

  // E2-3: a verificação por organização chega por webhook assinado (o servidor
  // grava `kyc_updated`). Enquanto estiver pendente, relê o onboard (idempotente)
  // a cada 5 s, até aprovar ou esgotar ~5 min. Falha de rede não derruba a tela:
  // a próxima leitura tenta de novo.
  const pending = onboard !== null && onboard.kycStatus !== 'approved';
  const [kycTimedOut, setKycTimedOut] = useState(false);
  const attempts = useRef(0);
  useEffect(() => {
    if (!pending) {
      attempts.current = 0;
      setKycTimedOut(false);
      return;
    }
    const id = setInterval(async () => {
      attempts.current += 1;
      if (attempts.current > KYC_POLL_MAX) {
        clearInterval(id);
        setKycTimedOut(true);
        return;
      }
      try {
        const data = await postJson<OnboardData>('/api/investidor/onboard', {}, getAccessToken);
        setOnboard((prev) => (prev ? { ...prev, kycStatus: data.kycStatus } : data));
      } catch {
        /* próxima leitura */
      }
    }, KYC_POLL_MS);
    return () => clearInterval(id);
  }, [pending, getAccessToken]);

  return { onboard, onboarding, runOnboard, kycPending: pending, kycTimedOut };
}
