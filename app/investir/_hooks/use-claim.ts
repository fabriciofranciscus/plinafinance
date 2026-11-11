'use client';

import { useCallback, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type { ClaimResult, FlowError, OnRampData, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';
import { xdrExpirado } from '../_lib/xdr-bounds';
import {
  CLAIM_XDR_EXPIRADO_MESSAGE,
  ClaimXdrExpiradoError,
  submitClaim,
} from '../_lib/claim-submit';

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
  // O XDR do claim foi regenerado (venceu) — a tela avisa que a assinatura é nova.
  const [claimRegenerated, setClaimRegenerated] = useState(false);

  // PLINA-MOD-007 / E2-3: o investidor reclama o ClaimableBalance do anchor. O
  // servidor monta o XDR (changeTrust do TESOURO quando falta + claim, com a
  // reserva patrocinada) e o regenera quando vence. Aqui: se o XDR devolvido
  // já venceu (ou vence antes de dar tempo de assinar), pede outro; se o
  // submit responder XDR expirado (409 `XDR_EXPIRADO`), refaz o build e a
  // assinatura uma vez. Nunca submete um XDR velho.
  const doClaim = useCallback(async () => {
    if (!onboard || !onRamp || !onRamp.stellarClaimableBalanceId) return;
    setClaiming(true);
    setClaimRegenerated(false);
    clearError();
    try {
      const build = async () => {
        let built = await postJson<{ xdr: string; hashHex: string; balanceId: string }>(
          '/api/investidor/buy/claim/build',
          { orderId: onRamp.orderId },
          getAccessToken,
        );
        if (xdrExpirado(built.xdr)) {
          // O servidor entregou um XDR já vencido: um novo build o regenera.
          setClaimRegenerated(true);
          built = await postJson(
            '/api/investidor/buy/claim/build',
            { orderId: onRamp.orderId },
            getAccessToken,
          );
          if (xdrExpirado(built.xdr)) throw new Error(CLAIM_XDR_EXPIRADO_MESSAGE);
        }
        return built;
      };
      const signAndSubmit = async (built: { xdr: string; hashHex: string; balanceId: string }) => {
        const { signature } = await signRawHash({
          address: onboard.publicKey,
          chainType: 'stellar',
          hash: built.hashHex as `0x${string}`,
        });
        return submitClaim(
          { orderId: onRamp.orderId, xdr: built.xdr, signatureHex: signature },
          getAccessToken,
        );
      };

      let built = await build();
      let data: { claimTxHash: string };
      try {
        data = await signAndSubmit(built);
      } catch (err) {
        if (!(err instanceof ClaimXdrExpiradoError)) throw err;
        setClaimRegenerated(true);
        built = await build();
        try {
          data = await signAndSubmit(built);
        } catch (err2) {
          if (err2 instanceof ClaimXdrExpiradoError) {
            throw new Error(CLAIM_XDR_EXPIRADO_MESSAGE);
          }
          throw err2;
        }
      }
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

  return { claiming, claimResult, claimRegenerated, doClaim };
}
