'use client';

import { useCallback, useState } from 'react';
import type { FlowError, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';

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

  return { onboard, onboarding, runOnboard };
}
