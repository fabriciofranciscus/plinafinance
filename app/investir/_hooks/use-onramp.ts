'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowError, OnRampData, QuoteData, Screen } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson, unwrapEnvelope } from '@/lib/http/client';

export interface UseOnRampArgs {
  quote: QuoteData | null;
  screen: Screen;
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
  onCreated: () => void;
  onSandboxPaid: () => void;
  setOnRampLoading: (loading: boolean) => void;
  onRampLoading: boolean;
}

export function useOnRamp({
  quote,
  screen,
  getAccessToken,
  onError,
  clearError,
  onCreated,
  onSandboxPaid,
  setOnRampLoading,
  onRampLoading,
}: UseOnRampArgs) {
  const [onRamp, setOnRamp] = useState<OnRampData | null>(null);
  const [paying, setPaying] = useState(false);

  // Cria onramp Etherfuse + transita pra screen de pagamento PIX.
  const goToOnramp = useCallback(async () => {
    if (!quote) return;
    setOnRampLoading(true);
    clearError();
    try {
      const data = await postJson<OnRampData>(
        '/api/investidor/buy/onramp/create',
        { quoteId: quote.quoteId },
        getAccessToken,
      );
      setOnRamp(data);
      onCreated();
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setOnRampLoading(false);
    }
  }, [quote, getAccessToken, onError, clearError, onCreated, setOnRampLoading]);

  // Sandbox-only: dispara simulação de PIX pago. Após resolver, vai pro
  // settling screen que vai pollar até completed.
  const sandboxPay = useCallback(async () => {
    if (!onRamp) return;
    setPaying(true);
    clearError();
    try {
      const data = await postJson<{
        status: string;
        stellarTxHash: string | null;
        stellarClaimableBalanceId?: string | null;
        mock: boolean;
      }>(
        '/api/investidor/buy/onramp/sandbox-pay',
        { orderId: onRamp.orderId },
        getAccessToken,
      );
      setOnRamp({ ...onRamp, ...data });
      onSandboxPaid();
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setPaying(false);
    }
  }, [onRamp, getAccessToken, onError, clearError, onSandboxPaid]);

  // Polling do status da onramp no settling screen — para quando completed.
  // As dependências são PRIMITIVAS (id da ordem e "ainda esperando"), não o objeto `onRamp`: cada resposta cria um objeto novo
  // (`{ ...prev, ...data }`), e com ele como dependência o efeito reiniciava e consultava de novo NA HORA, num laço sem pausa
  // (martelava a rota de status, que consulta o anchor). `getAccessToken` fica em ref pelo mesmo motivo: em alguns provedores
  // a identidade dele muda a cada render.
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const orderIdEmEspera = onRamp && onRamp.status !== 'completed' ? onRamp.orderId : null;
  useEffect(() => {
    if (screen !== 'settling' || !orderIdEmEspera) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const token = await tokenRef.current();
        const res = await fetch(
          `/api/investidor/buy/onramp/status?orderId=${encodeURIComponent(orderIdEmEspera)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        // Desembrulha o envelope `{ data, error }` (rota migrada pro withApi).
        const data = await unwrapEnvelope<{
          status: string;
          stellarTxHash: string | null;
          stellarClaimableBalanceId?: string | null;
          claimTxHash?: string | null;
          mock: boolean;
        }>(res);
        if (cancelled) return;
        setOnRamp((prev) => (prev ? { ...prev, ...data } : prev));
      } catch {
        // ignora — próximo tick retenta
      }
    };
    void tick();
    const id = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [screen, orderIdEmEspera]);

  const applyClaimTxHash = useCallback((claimTxHash: string) => {
    setOnRamp((prev) => (prev ? { ...prev, claimTxHash } : prev));
  }, []);

  const resetOnRamp = useCallback(() => {
    setOnRamp(null);
  }, []);

  return {
    onRamp,
    onRampLoading,
    paying,
    goToOnramp,
    sandboxPay,
    applyClaimTxHash,
    resetOnRamp,
  };
}
