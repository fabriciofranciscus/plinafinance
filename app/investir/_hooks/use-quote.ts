'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseBrlAmount } from '@/lib/format/parse-brl';
import type { FlowError, OnboardData, QuoteData, Screen } from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseQuoteArgs {
  onboard: OnboardData | null;
  screen: Screen;
  onRampLoading: boolean;
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useQuote({
  onboard,
  screen,
  onRampLoading,
  getAccessToken,
  onError,
  clearError,
}: UseQuoteArgs) {
  const [amountBrl, setAmountBrl] = useState('');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Defende contra race: refreshQuote em voo quando user já clicou
  // "revisar compra". Sem ref, setQuote pode sobrescrever quote.quoteId
  // enquanto /onramp/create persiste no DB com o quoteId anterior,
  // quebrando o lookup em /swap/build.
  const quoteGateRef = useRef({ screen: 'welcome' as Screen, onRampLoading: false });

  useEffect(() => {
    quoteGateRef.current = { screen, onRampLoading };
  }, [screen, onRampLoading]);

  const refreshQuote = useCallback(async () => {
    if (!onboard) return;
    const v = parseBrlAmount(amountBrl);
    if (v === null) return;
    setQuoteLoading(true);
    clearError();
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amountBrl: v.toFixed(2),
          customerId: onboard.etherfuseCustomerId,
          stellarAddress: onboard.publicKey,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as QuoteData;
      // Descarta resposta stale: user já saiu da tela de quote ou
      // disparou /onramp/create. Aplicar setQuote aqui sobrescreveria
      // quoteId já comprometido e quebra /swap/build com 409.
      const gate = quoteGateRef.current;
      if (gate.screen !== 'quote' || gate.onRampLoading) return;
      setQuote(data);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setQuoteLoading(false);
    }
  }, [onboard, amountBrl, getAccessToken, onError, clearError]);

  useEffect(() => {
    // Não agenda quote refresh se já está commitando onramp — caso
    // contrário o timer pode disparar uma fetch que retorna depois e
    // sobrescreve quoteId em uso pelo /onramp/create.
    if (screen !== 'quote' || !onboard || onRampLoading) return;
    const t = setTimeout(() => {
      void refreshQuote();
    }, 600);
    return () => clearTimeout(t);
  }, [amountBrl, screen, onboard, onRampLoading, refreshQuote]);

  const resetQuote = useCallback(() => {
    setQuote(null);
  }, []);

  return { amountBrl, setAmountBrl, quote, quoteLoading, resetQuote };
}
