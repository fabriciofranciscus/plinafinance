'use client';

/**
 * Carrega um endpoint /api/me/* com o token Privy (timeout de 8 s no token e 10 s
 * na requisição, como no resto do fluxo). Estado: carregando | erro | ok. Com
 * `exemplo`, devolve os dados de exemplo sem chamar a rede.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppPrivy } from '@/lib/hooks/privy';
import { withTimeout } from '@/lib/http/client';
import { useLatest } from '@/lib/hooks/use-latest';

export type EstadoMe<T> = { tipo: 'carregando' } | { tipo: 'erro' } | { tipo: 'ok'; dados: T };

export function useMe<T>(caminho: string, opcoes: { exemplo?: T | null } = {}): { estado: EstadoMe<T>; recarregar: () => void } {
  const { ready, authenticated, getAccessToken } = useAppPrivy();
  const exemplo = opcoes.exemplo ?? null;
  // A função do Privy pode mudar a cada renderização: fora das dependências, senão o GET entra em laço (Vera).
  const token = useLatest(getAccessToken);
  const [estadoReal, setEstado] = useState<EstadoMe<T>>({ tipo: 'carregando' });
  // Com `exemplo` o estado é derivado do parâmetro (não guardado): a URL pode chegar depois da 1ª renderização.
  const estado: EstadoMe<T> = exemplo ? { tipo: 'ok', dados: exemplo } : estadoReal;

  const carregar = useCallback(async () => {
    if (exemplo) return;
    setEstado({ tipo: 'carregando' });
    try {
      const bearer = await withTimeout(token.current(), 8000, 'sessão');
      const res = await withTimeout(
        fetch(caminho, { headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }),
        10000,
        'tempo',
      );
      if (!res.ok) throw new Error('http');
      setEstado({ tipo: 'ok', dados: (await res.json()) as T });
    } catch {
      setEstado({ tipo: 'erro' });
    }
  }, [caminho, exemplo, token]);

  useEffect(() => {
    if (ready && authenticated) void carregar();
  }, [ready, authenticated, carregar]);

  return { estado, recarregar: () => void carregar() };
}
