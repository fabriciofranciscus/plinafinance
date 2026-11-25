'use client';

/**
 * Detalhe do acompanhamento SÓ para o dono (item 19, Argus/Bento): busca GET /api/vender/acompanhar/<id> com o Bearer do
 * Privy (como /vender/minhas). A página pública entrega apenas a etapa; nome, valores, hashes e ids chegam aqui.
 *   - sem sessão: pede login e volta para esta página;
 *   - 404 (id inexistente, lead de OUTRA pessoa ou conta ainda sem cadastro: o servidor não distingue): "Solicitação não
 *     encontrada neste login";
 *   - 200: monta o AcompanharData e entrega à AcompanharView; depois de aceitar a proposta, recarrega.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AcompanharView, { type AcompanharData, type TxLink } from '@/components/vender/AcompanharView';
import { useAppPrivy } from '@/lib/hooks/privy';
import { withTimeout } from '@/lib/http/client';
import { useLatest } from '@/lib/hooks/use-latest';

/** Resposta do servidor: dinheiro e validade em string/ISO (a tela converte para exibir). */
interface DetalheServidor {
  leadId: string;
  status: string;
  etapaAtual: number;
  encerrado: boolean;
  contextoDescricao: string;
  cedenteNome: string | null;
  ofertaId: string | null;
  oferta: null | { valorCarta: string; desagioPct: string; valorLiquido: string; prazoRestanteMeses: number | null; validade: string };
  cessaoId: string | null;
  consentTx: TxLink | null;
  cessaoTx: TxLink | null;
  pixTx: TxLink | null;
  temCota: boolean;
  aguardandoAssinatura: boolean;
}

type Estado = { tipo: 'carregando' } | { tipo: 'nao-encontrada' } | { tipo: 'sem-sessao' } | { tipo: 'erro' } | { tipo: 'ok'; dados: DetalheServidor };

/** Só formata para exibição; o servidor já calculou. */
export function paraAcompanharData(d: DetalheServidor): AcompanharData {
  return {
    leadId: d.leadId,
    cedenteNome: d.cedenteNome,
    status: d.status,
    etapaAtual: d.etapaAtual,
    contextoDescricao: d.contextoDescricao,
    ofertaId: d.ofertaId,
    oferta: d.oferta
      ? {
          valorCarta: Number(d.oferta.valorCarta),
          desagioPct: d.oferta.desagioPct,
          valorLiquido: Number(d.oferta.valorLiquido),
          prazoRestanteMeses: d.oferta.prazoRestanteMeses,
          validade: new Date(d.oferta.validade).toLocaleString('pt-BR', { hour12: false }),
        }
      : null,
    cessaoId: d.cessaoId,
    consentTx: d.consentTx,
    cessaoTx: d.cessaoTx,
    pixTx: d.pixTx,
    temCota: d.temCota,
    aguardandoAssinatura: d.aguardandoAssinatura,
  };
}

export default function AcompanharPrivado({ leadId }: { leadId: string }) {
  const { ready, authenticated, getAccessToken } = useAppPrivy();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  // A função do Privy pode mudar a cada renderização: fora das dependências, senão o GET entra em laço (Vera).
  const token = useLatest(getAccessToken);

  const carregar = useCallback(async () => {
    setEstado((e) => (e.tipo === 'ok' ? e : { tipo: 'carregando' }));
    try {
      const bearer = await withTimeout(token.current(), 8000, 'sessão');
      const res = await withTimeout(
        fetch(`/api/vender/acompanhar/${encodeURIComponent(leadId)}`, {
          headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        }),
        10000,
        'tempo',
      );
      if (res.status === 401) return setEstado({ tipo: 'sem-sessao' });
      if (res.status === 404) return setEstado({ tipo: 'nao-encontrada' });
      if (!res.ok) throw new Error('http');
      setEstado({ tipo: 'ok', dados: (await res.json()) as DetalheServidor });
    } catch {
      setEstado((e) => (e.tipo === 'ok' ? e : { tipo: 'erro' }));
    }
  }, [leadId, token]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) setEstado({ tipo: 'sem-sessao' });
    else void carregar();
  }, [ready, authenticated, carregar]);

  if (estado.tipo === 'carregando') {
    return (
      <p role="status" className="font-text text-sm text-base/70">
        Carregando…
      </p>
    );
  }

  if (estado.tipo === 'sem-sessao') {
    return (
      <div data-testid="acompanhar-sem-sessao">
        <p className="font-text text-base/80 leading-relaxed">Entre para ver os detalhes desta solicitação.</p>
        <Link
          href={`/entrar?next=${encodeURIComponent(`/vender/acompanhar/${leadId}`)}`}
          className="mt-4 inline-flex min-h-[44px] items-center bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-signal-700 transition-colors"
        >
          Entrar para ver os detalhes
        </Link>
      </div>
    );
  }

  if (estado.tipo === 'nao-encontrada') {
    return (
      <div data-testid="acompanhar-nao-encontrada" role="alert">
        <p className="font-text text-base/80 leading-relaxed">Solicitação não encontrada neste login.</p>
        <p className="font-text text-sm text-base/70 mt-2">Confira se entrou com a conta que enviou a cota.</p>
        <Link href="/vender/minhas" className="mt-4 inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-primary-deep">
          Ver minhas solicitações →
        </Link>
      </div>
    );
  }

  if (estado.tipo === 'erro') {
    return (
      <div role="alert">
        <p className="font-text text-sm text-base/80">Não foi possível carregar a solicitação agora.</p>
        <button
          type="button"
          onClick={() => void carregar()}
          className="mt-3 min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-signal-700 transition-colors"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const d = estado.dados;
  return d.encerrado ? (
    <p className="font-text text-base/80 leading-relaxed">{d.contextoDescricao}</p>
  ) : (
    // `key`: ao mudar a etapa (ex.: depois de aceitar) a view remonta na etapa nova e solta o estado de "enviando".
    <AcompanharView key={`${d.status}:${d.etapaAtual}`} data={paraAcompanharData(d)} onAtualizar={() => void carregar()} />
  );
}
