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

  // Consulta o status da ordem e junta o resultado na ordem do estado. Usada pelo polling do settling screen e pelo
  // "Atualizar agora" (U2 A-09). Falha de rede é ignorada: o próximo tick (ou clique) retenta.
  const [atualizando, setAtualizando] = useState(false);
  // `getAccessToken` em ref: em alguns provedores a identidade dele muda a cada render e, como dependência, reiniciaria o polling.
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const consultar = useCallback(
    async (orderId: string, cancelado: () => boolean = () => false) => {
      try {
        const token = await tokenRef.current();
        const res = await fetch(`/api/investidor/buy/onramp/status?orderId=${encodeURIComponent(orderId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        // Desembrulha o envelope `{ data, error }` (rota migrada pro withApi).
        const data = await unwrapEnvelope<{
          status: string;
          stellarTxHash: string | null;
          stellarClaimableBalanceId?: string | null;
          claimTxHash?: string | null;
          mock: boolean;
          desde?: string | null;
          atrasada?: boolean;
          limiteSegundos?: number;
        }>(res);
        if (cancelado()) return;
        setOnRamp((prev) => (prev ? { ...prev, ...data } : prev));
      } catch {
        // ignora — próximo tick retenta
      }
    },
    [],
  );

  // Polling do status da onramp no settling screen — para quando completed. As dependências são PRIMITIVAS (id da ordem e "ainda
  // esperando"), não o objeto `onRamp`: cada resposta cria um objeto novo, e com ele como dependência o efeito reiniciava e
  // consultava de novo na hora, num laço sem pausa (martelava a rota de status, que consulta o anchor). U2 A-09.
  const orderIdEmEspera = onRamp && onRamp.status !== 'completed' ? onRamp.orderId : null;
  useEffect(() => {
    if (screen !== 'settling' || !orderIdEmEspera) return;
    let cancelled = false;
    void consultar(orderIdEmEspera, () => cancelled);
    const id = setInterval(() => void consultar(orderIdEmEspera, () => cancelled), 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [screen, orderIdEmEspera, consultar]);

  // "Atualizar agora" (U2 A-09): consulta já, sem esperar o próximo tick.
  const atualizarAgora = useCallback(async () => {
    if (!onRamp) return;
    setAtualizando(true);
    try {
      await consultar(onRamp.orderId);
    } finally {
      setAtualizando(false);
    }
  }, [onRamp, consultar]);

  const applyClaimTxHash = useCallback((claimTxHash: string) => {
    setOnRamp((prev) => (prev ? { ...prev, claimTxHash } : prev));
  }, []);

  const resetOnRamp = useCallback(() => {
    setOnRamp(null);
  }, []);

  // Retomada (U2 A-02): devolve ao hook a ordem de uma compra já em andamento, lida do servidor.
  const restoreOnRamp = useCallback((o: OnRampData) => {
    setOnRamp(o);
  }, []);

  return {
    onRamp,
    onRampLoading,
    paying,
    atualizando,
    atualizarAgora,
    goToOnramp,
    sandboxPay,
    applyClaimTxHash,
    resetOnRamp,
    restoreOnRamp,
  };
}
