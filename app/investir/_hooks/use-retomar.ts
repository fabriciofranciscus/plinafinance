'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OnboardData, OnRampData, OrdemPendente, QuoteData, Screen } from '../_types';

export interface UseRetomarArgs {
  pendente: OrdemPendente | null;
  onboard: OnboardData | null;
  quote: QuoteData | null;
  onRamp: OnRampData | null;
  /** Garante o `onboard` (rota idempotente para quem já se cadastrou). */
  runOnboard: () => Promise<void> | void;
  restoreQuote: (q: QuoteData) => void;
  restoreOnRamp: (o: OnRampData) => void;
  setScreen: (s: Screen) => void;
  /** O `goToConfirm` do swap: build do envelope, tela `confirm`. É o MESMO caminho da compra normal. */
  goToConfirm: () => Promise<void> | void;
  /** A retomada foi aplicada: o cartão some. */
  onRetomada: () => void;
}

/**
 * U2 A-02: retoma a compra que ficou pela metade. Só acontece quando o usuário CLICA (nunca sozinha: é fluxo de dinheiro).
 * Passos: (1) garante o `onboard`; (2) devolve `quote` e `onRamp` aos hooks; (3) quando os dois já estão no estado, escolhe a
 * tela pela `fase`. O swap NÃO tem caminho novo: `concluir_swap` chama o `goToConfirm` de sempre, e o servidor segue validando
 * dono do quote, estado da ordem e conferência. `em_conferencia` não tem ação.
 */
export function useRetomar({
  pendente,
  onboard,
  quote,
  onRamp,
  runOnboard,
  restoreQuote,
  restoreOnRamp,
  setScreen,
  goToConfirm,
  onRetomada,
}: UseRetomarArgs) {
  const [retomando, setRetomando] = useState(false);
  const [restaurado, setRestaurado] = useState(false);

  const retomar = useCallback(() => {
    if (!pendente || pendente.fase === 'em_conferencia') return;
    setRestaurado(false);
    setRetomando(true);
    if (!onboard) void runOnboard();
  }, [pendente, onboard, runOnboard]);

  useEffect(() => {
    if (!retomando || !pendente || !onboard) return;
    if (!restaurado) {
      restoreQuote(pendente.quote);
      restoreOnRamp(pendente.onRamp);
      setRestaurado(true);
      return;
    }
    // Espera o estado dos hooks refletir a ordem restaurada (o `goToConfirm` lê `quote` e `onRamp` do render atual).
    if (quote?.quoteId !== pendente.quote.quoteId || onRamp?.orderId !== pendente.onRamp.orderId) return;
    setRetomando(false);
    setRestaurado(false);
    onRetomada();
    switch (pendente.fase) {
      case 'aguardando_pagamento':
        setScreen('onramp');
        break;
      case 'liquidando':
        setScreen('settling');
        break;
      case 'resgatar_tesouro':
        setScreen('claiming');
        break;
      case 'concluir_swap':
        void goToConfirm();
        break;
      case 'em_conferencia':
        break;
    }
  }, [retomando, restaurado, pendente, onboard, quote, onRamp, restoreQuote, restoreOnRamp, setScreen, goToConfirm, onRetomada]);

  return { retomando, retomar };
}
