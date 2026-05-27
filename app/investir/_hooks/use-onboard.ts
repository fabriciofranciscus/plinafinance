'use client';

import { useCallback, useState } from 'react';
import type { FlowError, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseOnboardArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useOnboard({ getAccessToken, onError, clearError }: UseOnboardArgs) {
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  const runOnboard = useCallback(async () => {
    clearError();
    setOnboarding(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const res = await fetch('/api/investidor/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`onboarding: ${await res.text()}`);
      setOnboard((await res.json()) as OnboardData);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setOnboarding(false);
    }
  }, [getAccessToken, onError, clearError]);

  return { onboard, onboarding, runOnboard };
}
