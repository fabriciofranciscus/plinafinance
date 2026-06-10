'use client';

import { useCallback, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type { ClaimResult, FlowError, OnRampData, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';

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
      const built = await postJson<{
        xdr: string;
        hashHex: string;
        balanceId: string;
      }>(
        '/api/investidor/buy/claim/build',
        { orderId: onRamp.orderId },
        getAccessToken,
      );
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: built.hashHex as `0x${string}`,
      });
      const data = await postJson<{ claimTxHash: string }>(
        '/api/investidor/buy/claim/submit',
        {
          orderId: onRamp.orderId,
          xdr: built.xdr,
          signatureHex: signature,
        },
        getAccessToken,
      );
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
