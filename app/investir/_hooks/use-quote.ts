'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseBrlAmount } from '@/lib/format/parse-brl';
import type {
  ClasseEscolhida,
  FlowError,
  OnboardData,
  QuoteData,
  Screen,
} from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';

export interface UseQuoteArgs {
  onboard: OnboardData | null;
  classe: ClasseEscolhida;
  screen: Screen;
  onRampLoading: boolean;
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useQuote({
  onboard,
  classe,
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
  const quoteGateRef = useRef({ screen: 'identity' as Screen, onRampLoading: false });

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
      const data = await postJson<QuoteData>(
        '/api/investidor/quote',
        {
          amountBrl: v.toFixed(2),
          customerId: onboard.etherfuseCustomerId,
          stellarAddress: onboard.publicKey,
          classe,
        },
        getAccessToken,
      );
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
  }, [onboard, amountBrl, classe, getAccessToken, onError, clearError]);

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

  // Retomada (U2 A-02): devolve ao hook a cotação de uma compra já em andamento, lida do servidor.
  const restoreQuote = useCallback((q: QuoteData) => {
    setQuote(q);
  }, []);

  return { amountBrl, setAmountBrl, quote, quoteLoading, resetQuote, restoreQuote };
}
