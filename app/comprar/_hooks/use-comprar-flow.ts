'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppPrivy } from '@/lib/hooks/privy';
import { usePessoa } from '@/components/PessoaProvider';
import type { CotaResumo, FlowError, Screen } from '../_types';
import { useCotas } from './use-cotas';
import { useDiligencia } from './use-diligencia';
import { useReserva } from './use-reserva';
import { useKyc } from './use-kyc';
import { useCessao } from './use-cessao';

export function useComprarFlow() {
  const privy = useAppPrivy();
  const { getAccessToken } = privy;
  const pessoa = usePessoa();

  const [screen, setScreen] = useState<Screen>('buscar');
  const [error, setError] = useState<FlowError | null>(null);
  const [selectedCota, setSelectedCota] = useState<CotaResumo | null>(null);

  const onError = useCallback((e: FlowError) => setError(e), []);
  const clearError = useCallback(() => setError(null), []);
  const dismissError = clearError;

  const cotasHook = useCotas({ getAccessToken, onError, clearError });
  const diligenciaHook = useDiligencia({ getAccessToken, onError, clearError });
  const reservaHook = useReserva({ getAccessToken, onError, clearError });
  const kycHook = useKyc({ getAccessToken, onError, clearError });
  const cessaoHook = useCessao({ getAccessToken, onError, clearError });

  // Carrega a lista de cotas uma vez ao montar.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void cotasHook.load();
  }, [cotasHook]);

  // ── Transições ──────────────────────────────────────────────────────────
  const onSelectCota = useCallback(
    (cota: CotaResumo) => {
      setSelectedCota(cota);
      void diligenciaHook.fetchDiligencia(cota.id);
      setScreen('diligencia');
    },
    [diligenciaHook],
  );

  const onDiligenciaContinue = useCallback(() => setScreen('proposta'), []);

  const onAceitarProposta = useCallback(() => {
    if (!selectedCota) return;
    void reservaHook.criar(selectedCota.id).then((reserva) => {
      if (reserva) setScreen(pessoa.kycAprovado ? 'cessao' : 'kyc');
    });
  }, [selectedCota, reservaHook, pessoa.kycAprovado]);

  const onKycSubmit = useCallback(
    (input: { nome?: string; cpf?: string }) => {
      void kycHook.submeter(input).then(async (ok) => {
        if (ok) {
          await pessoa.refresh();
          setScreen('cessao');
        }
      });
    },
    [kycHook, pessoa],
  );

  const onAssinarCessao = useCallback(() => {
    const reservaId = reservaHook.reserva?.reservaId;
    if (!reservaId) return;
    void cessaoHook.assinar(reservaId).then((cessao) => {
      if (cessao) setScreen('confirmacao');
    });
  }, [reservaHook.reserva, cessaoHook]);

  const onConfirmar = useCallback(() => {
    const reservaId = reservaHook.reserva?.reservaId;
    if (!reservaId) return;
    void cessaoHook.confirmar(reservaId);
  }, [reservaHook.reserva, cessaoHook]);

  // Voltar só é permitido antes da reserva (passos 1–3), pra não conflitar
  // com o estado já comprometido no banco/on-chain.
  const canGoBack = screen === 'diligencia' || screen === 'proposta';
  const goBack = useCallback(() => {
    setScreen((s) => (s === 'proposta' ? 'diligencia' : s === 'diligencia' ? 'buscar' : s));
  }, []);

  return {
    privy,
    pessoa,
    screen,
    error,
    dismissError,
    selectedCota,
    canGoBack,
    goBack,
    onSelectCota,
    onDiligenciaContinue,
    onAceitarProposta,
    onKycSubmit,
    onAssinarCessao,
    onConfirmar,
    cotas: cotasHook,
    diligencia: diligenciaHook,
    reserva: reservaHook,
    kyc: kycHook,
    cessao: cessaoHook,
  };
}
