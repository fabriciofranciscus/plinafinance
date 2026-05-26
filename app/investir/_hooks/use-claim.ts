'use client';

import { useCallback, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type { ClaimResult, FlowError, OnRampData, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseClaimArgs {
  onboard: OnboardData | null;
  onRamp: OnRampData | null;
  signRawHash: ReturnType<typeof useSignRawHash>['signRawHash'];
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
  onClaimed: (claimTxHash: string) => void;
}

export function useClaim({
  onboard,
  onRamp,
  signRawHash,
  getAccessToken,
  onError,
  clearError,
  onClaimed,
}: UseClaimArgs) {
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);

  // PLINA-MOD-007: investor reclama o ClaimableBalance criado pela Etherfuse
  // pra TESOURO entrar na trustline. Sem isso, swap atômico falha por saldo 0.
  const doClaim = useCallback(async () => {
    if (!onboard || !onRamp || !onRamp.stellarClaimableBalanceId) return;
    setClaiming(true);
    clearError();
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const buildRes = await fetch('/api/investidor/buy/claim/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId: onRamp.orderId }),
      });
      if (!buildRes.ok) throw new Error(await buildRes.text());
      const built = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
        balanceId: string;
      };
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: built.hashHex as `0x${string}`,
      });
      const submitRes = await fetch('/api/investidor/buy/claim/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: onRamp.orderId,
          xdr: built.xdr,
          signatureHex: signature,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      const data = (await submitRes.json()) as { claimTxHash: string };
      setClaimResult({
        claimTxHash: data.claimTxHash,
        balanceId: built.balanceId,
      });
      onClaimed(data.claimTxHash);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setClaiming(false);
    }
  }, [onboard, onRamp, signRawHash, getAccessToken, onError, clearError, onClaimed]);

  return { claiming, claimResult, doClaim };
}
