'use client';

import { useCallback, useState } from 'react';
import { postJson } from '@/lib/http/client';
import { asFlowError } from '@/app/investir/_lib/errors';
import type { CessaoData, ConfirmacaoData, FlowError } from '../_types';

export interface UseCessaoArgs {
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useCessao({ getAccessToken, onError, clearError }: UseCessaoArgs) {
  const [cessao, setCessao] = useState<CessaoData | null>(null);
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoData | null>(null);
  const [signing, setSigning] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const assinar = useCallback(
    async (reservaId: string): Promise<CessaoData | null> => {
      clearError();
      setSigning(true);
      try {
        const data = await postJson<CessaoData>(
          '/api/comprar/cessao',
          { reservaId },
          getAccessToken,
        );
        setCessao(data);
        return data;
      } catch (err) {
        onError(asFlowError(err));
        return null;
      } finally {
        setSigning(false);
      }
    },
    [getAccessToken, onError, clearError],
  );

  const confirmar = useCallback(
    async (reservaId: string): Promise<ConfirmacaoData | null> => {
      clearError();
      setConfirming(true);
      try {
        const data = await postJson<ConfirmacaoData>(
          '/api/comprar/confirmar',
          { reservaId },
          getAccessToken,
        );
        setConfirmacao(data);
        return data;
      } catch (err) {
        onError(asFlowError(err));
        return null;
      } finally {
        setConfirming(false);
      }
    },
    [getAccessToken, onError, clearError],
  );

  return { cessao, confirmacao, signing, confirming, assinar, confirmar };
}
