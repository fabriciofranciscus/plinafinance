'use client';

import { useCallback, useState } from 'react';
import { getJson } from '@/lib/http/client';
import { asFlowError } from '@/app/investir/_lib/errors';
import type { DiligenciaData, FlowError } from '../_types';

export interface UseDiligenciaArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useDiligencia({ getAccessToken, onError, clearError }: UseDiligenciaArgs) {
  const [diligencia, setDiligencia] = useState<DiligenciaData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiligencia = useCallback(
    async (cotaId: string): Promise<DiligenciaData | null> => {
      clearError();
      setLoading(true);
      setDiligencia(null);
      try {
        const data = await getJson<DiligenciaData>(
          `/api/comprar/cota/${cotaId}/diligencia`,
          getAccessToken,
        );
        setDiligencia(data);
        return data;
      } catch (err) {
        onError(asFlowError(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [getAccessToken, onError, clearError],
  );

  return { diligencia, loading, fetchDiligencia };
}
