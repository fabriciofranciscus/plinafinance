'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FlowError, OnRampData, QuoteData, Screen } from '../_types';
import { asFlowError } from '../_lib/errors';

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
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/onramp/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as OnRampData;
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
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/onramp/sandbox-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId: onRamp.orderId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        status: string;
        stellarTxHash: string | null;
        stellarClaimableBalanceId?: string | null;
        mock: boolean;
      };
      setOnRamp({ ...onRamp, ...data });
      onSandboxPaid();
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setPaying(false);
    }
  }, [onRamp, getAccessToken, onError, clearError, onSandboxPaid]);

  // Polling do status da onramp no settling screen — para quando completed.
  useEffect(() => {
    if (screen !== 'settling' || !onRamp || onRamp.status === 'completed') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `/api/investidor/buy/onramp/status?orderId=${encodeURIComponent(onRamp.orderId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          stellarTxHash: string | null;
          stellarClaimableBalanceId?: string | null;
          claimTxHash?: string | null;
          mock: boolean;
        };
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
  }, [screen, onRamp, getAccessToken]);

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
