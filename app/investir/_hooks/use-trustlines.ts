'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppSignRawHash as useSignRawHash } from '@/lib/hooks/privy';
import type { FlowError, OnboardData } from '../_types';
import { asFlowError } from '../_lib/errors';
import { postJson } from '@/lib/http/client';

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

  // Trustline é estado on-chain — persiste entre reloads. O onboard reporta se
  // já existem (investidorTrustlinesReady), evitando re-pedir assinatura.
  useEffect(() => {
    if (onboard?.trustlinesReady) setTrustlinesReady(true);
  }, [onboard?.trustlinesReady]);

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
      // Helper: build+sign+submit pra um asset code específico de PLINA-RF.
      const setupClasseTrustline = async (assetCode?: string) => {
        const buildData = await postJson<Partial<{ xdr: string; hashHex: string }>>(
          '/api/investidor/buy/trust-plinarf/build',
          {
            pubkey: onboard.publicKey,
            ...(assetCode ? { assetCode } : {}),
          },
          getAccessToken,
        );
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
        await postJson(
          '/api/investidor/buy/trust-plinarf/submit',
          {
            xdr: buildData.xdr,
            investorPubkey: onboard.publicKey,
            signatureHex: sig.signature,
            ...(assetCode ? { assetCode } : {}),
          },
          getAccessToken,
        );
      };

      // PLINARF (Sênior, legacy).
      await setupClasseTrustline();
      // PLINARFB (Subordinada).
      await setupClasseTrustline('PLINARFB');

      // TESOURO trustline (bridge da Etherfuse).
      const tesouroBuildData = await postJson<{ xdr: string; hashHex: string }>(
        '/api/investidor/buy/trust-tesouro/build',
        { pubkey: onboard.publicKey },
        getAccessToken,
      );
      const tesouroSig = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: tesouroBuildData.hashHex as `0x${string}`,
      });
      await postJson(
        '/api/investidor/buy/trust-tesouro/submit',
        {
          xdr: tesouroBuildData.xdr,
          investorPubkey: onboard.publicKey,
          signatureHex: tesouroSig.signature,
        },
        getAccessToken,
      );

      setTrustlinesReady(true);
    } catch (err) {
      onError(asFlowError(err));
    } finally {
      setTrustlineLoading(false);
    }
  }, [onboard, signRawHash, trustlinesReady, trustlineLoading, getAccessToken, onError, clearError]);

  return { trustlinesReady, trustlineLoading, setupTrustlines };
}
