'use client';

import { useCallback, useState } from 'react';
import type { BankRegistered, FlowError, OnboardData, PixKeyType } from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseBankingArgs {
  onboard: OnboardData | null;
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
  onRegistered: () => void;
}

export function useBanking({
  onboard,
  getAccessToken,
  onError,
  clearError,
  onRegistered,
}: UseBankingArgs) {
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>('cpf');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cpf, setCpf] = useState('');
  const [bankInfo, setBankInfo] = useState<BankRegistered | null>(null);
  const [loading, setLoading] = useState(false);

  // PLINA-MOD-006: registra bank PIX programaticamente. Idempotente — se
  // investidor já tem etherfuseBankAccountId, handler retorna 200 + idempotent.
  const registerBank = useCallback(async () => {
    if (!onboard) return;
    if (!pixKey || !cpf || !firstName || !lastName) {
      onError(asFlowError(new Error('Preencha PIX, CPF, nome e sobrenome.')));
      return;
    }
    setLoading(true);
    clearError();
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const res = await fetch('/api/investidor/bank-account/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pixKey,
          pixKeyType,
          cpf,
          firstName,
          lastName,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as BankRegistered;
      setBankInfo(data);
      onRegistered();
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setLoading(false);
    }
  }, [
    onboard,
    pixKey,
    pixKeyType,
    cpf,
    firstName,
    lastName,
    getAccessToken,
    onError,
    clearError,
    onRegistered,
  ]);

  return {
    bankInfo,
    loading,
    registerBank,
    fields: {
      pixKey,
      setPixKey,
      pixKeyType,
      setPixKeyType,
      firstName,
      setFirstName,
      lastName,
      setLastName,
      cpf,
      setCpf,
    },
  };
}
