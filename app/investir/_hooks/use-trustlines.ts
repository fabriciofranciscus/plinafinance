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

  // Trustline setup (PLINARF Sênior + PLINARFB Subordinada + TESOURO).
  // F-M3-3: investidor estabelece as duas classes no identity — a escolha de
  // classe (Sênior vs Subordinada) acontece depois, no quote, sem precisar
  // voltar pra autorizar trustline da classe que vai receber a emissão.
  // Idempotente em todos os passos (server-side).
  const setupTrustlines = useCallback(async () => {
    if (!onboard || trustlinesReady || trustlineLoading) return;
    setTrustlineLoading(true);
    clearError();
    try {
      const token = await getAccessToken();
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      // Helper: build+sign+submit pra um asset code específico de PLINA-RF.
      const setupClasseTrustline = async (assetCode?: string) => {
        const buildRes = await fetch(
          '/api/investidor/buy/trust-plinarf/build',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              pubkey: onboard.publicKey,
              ...(assetCode ? { assetCode } : {}),
            }),
          },
        );
        if (!buildRes.ok) throw new Error(await buildRes.text());
        const buildData = (await buildRes.json()) as Partial<{
          xdr: string;
          hashHex: string;
        }>;
        const missing = (['xdr', 'hashHex'] as const).filter((k) => !buildData[k]);
        if (missing.length > 0) {
          throw new Error(
            `/buy/trust-plinarf/build devolveu resposta incompleta — faltam: ${missing.join(', ')}`,
          );
        }
        const sig = await signRawHash({
          address: onboard.publicKey,
          chainType: 'stellar',
          hash: buildData.hashHex as `0x${string}`,
        });
        const submitRes = await fetch(
          '/api/investidor/buy/trust-plinarf/submit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              xdr: buildData.xdr,
              investorPubkey: onboard.publicKey,
              signatureHex: sig.signature,
              ...(assetCode ? { assetCode } : {}),
            }),
          },
        );
        if (!submitRes.ok) throw new Error(await submitRes.text());
      };

      // PLINARF (Sênior, legacy).
      await setupClasseTrustline();
      // PLINARFB (Subordinada).
      await setupClasseTrustline('PLINARFB');

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
