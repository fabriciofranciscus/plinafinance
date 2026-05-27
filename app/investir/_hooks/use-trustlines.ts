'use client';

import { useCallback, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type { FlowError, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';

export interface UseTrustlinesArgs {
  onboard: OnboardData | null;
  signRawHash: ReturnType<typeof useSignRawHash>['signRawHash'];
  getAccessToken: () => Promise<string | null>;
  onError: (e: FlowError) => void;
  clearError: () => void;
}

export function useTrustlines({
  onboard,
  signRawHash,
  getAccessToken,
  onError,
  clearError,
}: UseTrustlinesArgs) {
  const [trustlinesReady, setTrustlinesReady] = useState(false);
  const [trustlineLoading, setTrustlineLoading] = useState(false);

  // Trustline setup (PLINARF + TESOURO). Idempotente: se trustlinesReady=true,
  // pula. PLINARF é pré-condição pra receber emissão; TESOURO é pré-condição
  // pra leg investor→distributor do swap atômico.
  const setupTrustlines = useCallback(async () => {
    if (!onboard || trustlinesReady || trustlineLoading) return;
    setTrustlineLoading(true);
    clearError();
    try {
      const token = await getAccessToken();
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      // PLINARF trustline.
      const plinarfBuild = await fetch(
        '/api/investidor/buy/trust-plinarf/build',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ pubkey: onboard.publicKey }),
        },
      );
      if (!plinarfBuild.ok) throw new Error(await plinarfBuild.text());
      const plinarfBuildData = (await plinarfBuild.json()) as Partial<{
        xdr: string;
        hashHex: string;
      }>;
      // Valida shape antes de avançar — sem isso, campos faltantes só
      // explodem em runtime no signRawHash/submit (PR #5 hardening).
      {
        const missing = (['xdr', 'hashHex'] as const).filter((k) => !plinarfBuildData[k]);
        if (missing.length > 0) {
          throw new Error(`/buy/trust-plinarf/build devolveu resposta incompleta — faltam: ${missing.join(', ')}`);
        }
      }
      const plinarfSig = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: plinarfBuildData.hashHex as `0x${string}`,
      });
      const plinarfSubmit = await fetch(
        '/api/investidor/buy/trust-plinarf/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            xdr: plinarfBuildData.xdr,
            investorPubkey: onboard.publicKey,
            signatureHex: plinarfSig.signature,
          }),
        },
      );
      if (!plinarfSubmit.ok) throw new Error(await plinarfSubmit.text());

      // TESOURO trustline (bridge da Etherfuse).
      const tesouroBuild = await fetch(
        '/api/investidor/buy/trust-tesouro/build',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ pubkey: onboard.publicKey }),
        },
      );
      if (!tesouroBuild.ok) throw new Error(await tesouroBuild.text());
      const tesouroBuildData = (await tesouroBuild.json()) as {
        xdr: string;
        hashHex: string;
      };
      const tesouroSig = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: tesouroBuildData.hashHex as `0x${string}`,
      });
      const tesouroSubmit = await fetch(
        '/api/investidor/buy/trust-tesouro/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            xdr: tesouroBuildData.xdr,
            investorPubkey: onboard.publicKey,
            signatureHex: tesouroSig.signature,
          }),
        },
      );
      if (!tesouroSubmit.ok) throw new Error(await tesouroSubmit.text());

      setTrustlinesReady(true);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setTrustlineLoading(false);
    }
  }, [onboard, signRawHash, trustlinesReady, trustlineLoading, getAccessToken, onError, clearError]);

  return { trustlinesReady, trustlineLoading, setupTrustlines };
}
