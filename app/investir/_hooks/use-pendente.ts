'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrdemPendente } from '../_types';
import { getJson } from '@/lib/http/client';

export interface UsePendenteArgs {
  /** Só consulta com a sessão pronta e autenticada. */
  enabled: boolean;
  getAccessToken: () => Promise<string | null>;
}

/**
 * U2 A-02: lê do servidor a compra que ficou pela metade (uma vez por sessão). Falha de rede ou de servidor = sem cartão: o
 * fluxo normal segue como sempre (a retomada é um atalho, nunca um pré-requisito). `getAccessToken` fica em ref: a identidade
 * dele muda a cada render em alguns provedores e, como dependência, repetiria o GET em laço.
 */
export function usePendente({ enabled, getAccessToken }: UsePendenteArgs) {
  const [pendente, setPendente] = useState<OrdemPendente | null>(null);
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await getJson<{ pendente: OrdemPendente | null }>(
          '/api/investidor/buy/pendente',
          () => tokenRef.current(),
        );
        if (!cancelled) setPendente(d?.pendente ?? null);
      } catch {
        // sem cartão de retomada; o fluxo normal não depende dele
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const limpar = useCallback(() => setPendente(null), []);
  return { pendente, limpar };
}
