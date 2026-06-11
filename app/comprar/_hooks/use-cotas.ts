'use client';

import { useCallback, useState } from 'react';
import { getJson } from '@/lib/http/client';
import { asFlowError } from '@/app/investir/_lib/errors';
import type { CotaResumo, FlowError } from '../_types';

export interface UseCotasArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useCotas({ getAccessToken, onError, clearError }: UseCotasArgs) {
  const [cotas, setCotas] = useState<CotaResumo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    clearError();
    setLoading(true);
    try {
      const data = await getJson<{ cotas: CotaResumo[] }>(
        '/api/comprar/cotas',
        getAccessToken,
      );
      setCotas(data.cotas);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, onError, clearError]);

  return { cotas, loading, load };
}
