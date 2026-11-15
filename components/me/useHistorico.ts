'use client';

/**
 * Histórico paginado (GET /api/me/historico?cursor=…): 20 por vez, botão
 * "Carregar mais", sem rolagem infinita. A lista já carregada permanece se a
 * página seguinte falhar. Com `exemplo`, usa os itens fictícios sem rede.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppPrivy } from '@/lib/hooks/privy';
import { withTimeout } from '@/lib/http/client';
import { useLatest } from '@/lib/hooks/use-latest';
import type { EventoHistorico, PaginaHistorico } from '@/lib/me/tipos';
import type { EstadoHistorico } from './HistoricoView';

export function useHistorico(exemplo: EventoHistorico[] | null) {
  const { ready, authenticated, getAccessToken } = useAppPrivy();
  const [estadoReal, setEstado] = useState<EstadoHistorico>({
    carregando: true,
    erro: false,
    itens: [],
    temMais: false,
    carregandoMais: false,
    erroMais: false,
  });
  const cursor = useRef<string | null>(null);
  // A função do Privy pode mudar a cada renderização: fora das dependências, senão o GET entra em laço (Vera).
  const token = useLatest(getAccessToken);
  // Com `exemplo` o estado é derivado do parâmetro (a URL pode chegar depois da 1ª renderização).
  const estado: EstadoHistorico = exemplo
    ? { carregando: false, erro: false, itens: exemplo, temMais: false, carregandoMais: false, erroMais: false }
    : estadoReal;

  const buscar = useCallback(
    async (primeira: boolean) => {
      if (exemplo) return;
      setEstado((s) => (primeira ? { ...s, carregando: true, erro: false, erroMais: false } : { ...s, carregandoMais: true, erroMais: false }));
      try {
        const bearer = await withTimeout(token.current(), 8000, 'sessão');
        const qs = !primeira && cursor.current ? `?cursor=${encodeURIComponent(cursor.current)}` : '';
        const res = await withTimeout(
          fetch(`/api/me/historico${qs}`, { headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }),
          10000,
          'tempo',
        );
        if (!res.ok) throw new Error('http');
        const pagina = (await res.json()) as PaginaHistorico;
        cursor.current = pagina.proximoCursor;
        setEstado((s) => ({
          carregando: false,
          erro: false,
          erroMais: false,
          carregandoMais: false,
          itens: primeira ? pagina.itens : [...s.itens, ...pagina.itens],
          temMais: !!pagina.proximoCursor,
        }));
      } catch {
        setEstado((s) => (primeira ? { ...s, carregando: false, erro: true } : { ...s, carregandoMais: false, erroMais: true }));
      }
    },
    [exemplo, token],
  );

  useEffect(() => {
    if (ready && authenticated) void buscar(true);
  }, [ready, authenticated, buscar]);

  return { estado, recarregar: () => void buscar(true), carregarMais: () => void buscar(false) };
}
