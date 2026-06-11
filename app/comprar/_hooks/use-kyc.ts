'use client';

import { useCallback, useState } from 'react';
import { postJson } from '@/lib/http/client';
import { asFlowError } from '@/app/investir/_lib/errors';
import type { FlowError } from '../_types';

export interface UseKycArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

interface KycResult {
  kycAprovado: boolean;
  kycStatus: string;
}

export function useKyc({ getAccessToken, onError, clearError }: UseKycArgs) {
  const [loading, setLoading] = useState(false);

  const submeter = useCallback(
    async (input: { nome?: string; cpf?: string }): Promise<boolean> => {
      clearError();
      setLoading(true);
      try {
        const data = await postJson<KycResult>(
          '/api/comprar/kyc',
          input,
          getAccessToken,
        );
        if (!data.kycAprovado) {
          throw new Error(`KYC não aprovado (status ${data.kycStatus}).`);
        }
        return true;
      } catch (err) {
        onError(asFlowError(err));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [getAccessToken, onError, clearError],
  );

  return { loading, submeter };
}
