'use client';

import { useCallback, useState } from 'react';
import { postJson } from '@/lib/http/client';
import { asFlowError } from '@/app/investir/_lib/errors';
import type { FlowError, ReservaData } from '../_types';

export interface UseReservaArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useReserva({ getAccessToken, onError, clearError }: UseReservaArgs) {
  const [reserva, setReserva] = useState<ReservaData | null>(null);
  const [loading, setLoading] = useState(false);

  const criar = useCallback(
    async (cotaId: string): Promise<ReservaData | null> => {
      clearError();
      setLoading(true);
      try {
        const data = await postJson<ReservaData>(
          '/api/comprar/reserva',
          { cotaId },
          getAccessToken,
        );
        setReserva(data);
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

  return { reserva, loading, criar };
}
