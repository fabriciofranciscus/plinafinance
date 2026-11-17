'use client';

/**
 * "Minhas solicitações" do cedente: lista os leads da própria conta
 * (GET /api/vender/minhas, withPessoaAuth) e cada item abre
 * /vender/acompanhar/<id>. A resposta não tem nome, e-mail, telefone nem CPF
 * (contrato do Bento, 15/11). Valores vêm do servidor: nada é calculado aqui.
 *
 * `pagina`: todos os estados (carregando, vazio, erro com nova tentativa).
 * `compacto` (topo do /vender): só aparece quando há solicitações, até 3, com
 * link para a lista completa; carregando, vazio e erro ficam em silêncio para
 * não atrapalhar o cadastro.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAppPrivy } from '@/lib/hooks/privy';
import { useLatest } from '@/lib/hooks/use-latest';
import { withTimeout } from '@/lib/http/client';
import { ETAPAS_VENDER } from '@/lib/vender/etapas';

export interface Solicitacao {
  id: string;
  status: string;
  etapa: number;
  encerrado: boolean;
  concluido: boolean;
  criadoEm: string;
  atualizadoEm: string;
  oferta: null | {
    status: string;
    tipoBem: string;
    valorCarta: string;
    valorLiquido: string;
    validade: string;
  };
}

const TIPO_BEM: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviço',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function brl(valor: string): string {
  const n = Number(valor);
  return Number.isFinite(n) ? BRL.format(n) : valor;
}

/** Id curto igual ao do /admin, para a pessoa e a equipe citarem a mesma solicitação. */
export function idCurtoSolicitacao(id: string): string {
  return id.slice(-6).toUpperCase();
}

export function rotuloDaEtapa(s: Pick<Solicitacao, 'status' | 'etapa' | 'encerrado' | 'concluido'>): string {
  if (s.encerrado) return 'Solicitação encerrada';
  // "Concluída" só com a cota incorporada: com o Pix pago a incorporação ainda não aconteceu (Consuelo, A-26).
  if (s.status === 'COTA_INCORPORADA') return 'Todas as etapas concluídas';
  if (s.status === 'PIX_EXECUTADO') return `Etapa atual: ${ETAPAS_VENDER[ETAPAS_VENDER.length - 1]}`;
  if (s.concluido) return 'Todas as etapas concluídas';
  return `Etapa atual: ${ETAPAS_VENDER[s.etapa] ?? 'em andamento'}`;
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'erro' }
  | { tipo: 'ok'; itens: Solicitacao[] };

export default function MinhasSolicitacoes({ variante = 'pagina' }: { variante?: 'pagina' | 'compacto' }) {
  const { ready, authenticated, getAccessToken } = useAppPrivy();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  // A função do Privy pode mudar a cada renderização: fora das dependências, senão o GET entra em laço.
  const token = useLatest(getAccessToken);

  const carregar = useCallback(async () => {
    setEstado({ tipo: 'carregando' });
    try {
      const bearer = await withTimeout(token.current(), 8000, 'sessão');
      const res = await withTimeout(
        fetch('/api/vender/minhas', {
          headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        }),
        10000,
        'tempo',
      );
      if (!res.ok) throw new Error('http');
      const body = (await res.json()) as { solicitacoes?: Solicitacao[] };
      setEstado({ tipo: 'ok', itens: Array.isArray(body.solicitacoes) ? body.solicitacoes : [] });
    } catch {
      setEstado({ tipo: 'erro' });
    }
  }, [token]);

  useEffect(() => {
    if (ready && authenticated) void carregar();
  }, [ready, authenticated, carregar]);

  const compacto = variante === 'compacto';
  // A página própria (/vender/minhas) precisa de um h1 (A-16); no topo do /vender o h1 é o da própria tela.
  const Titulo = compacto ? 'h2' : 'h1';
  if (compacto && (estado.tipo !== 'ok' || estado.itens.length === 0)) return null;

  const itens = estado.tipo === 'ok' ? (compacto ? estado.itens.slice(0, 3) : estado.itens) : [];

  return (
    <section aria-labelledby="minhas-solicitacoes-titulo" id="minhas-solicitacoes">
      <Titulo
        id="minhas-solicitacoes-titulo"
        className={`font-title font-semibold tracking-tight ${compacto ? 'text-xl' : 'text-3xl md:text-4xl'}`}
      >
        Minhas solicitações
      </Titulo>

      {estado.tipo === 'carregando' && (
        <p role="status" className="font-text text-sm text-base/70 mt-4">
          Carregando suas solicitações…
        </p>
      )}

      {estado.tipo === 'erro' && (
        <div role="alert" className="mt-4">
          <p className="font-text text-sm text-base/80">
            Não foi possível carregar suas solicitações agora.
          </p>
          <button
            type="button"
            onClick={() => void carregar()}
            className="mt-3 min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {estado.tipo === 'ok' && estado.itens.length === 0 && (
        <p className="font-text text-sm text-base/70 mt-4">
          Você ainda não tem solicitações. Ao enviar uma cota em{' '}
          <Link href="/vender" className="underline text-primary-deep">
            Venda sua cota contemplada
          </Link>
          , ela aparece aqui.
        </p>
      )}

      {itens.length > 0 && (
        <ul className="mt-4 space-y-3">
          {itens.map((s) => (
            <li key={s.id}>
              <Link
                href={`/vender/acompanhar/${s.id}`}
                className="block min-h-[44px] border border-light-hairline bg-white p-4 hover:border-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-base/70">
                    Solicitação #{idCurtoSolicitacao(s.id)}
                  </span>
                  <span className="font-mono text-xs text-base/60">
                    {new Date(s.criadoEm).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <span className="block font-text text-sm font-semibold mt-1">{rotuloDaEtapa(s)}</span>
                <span className="block font-text text-xs text-base/70 mt-1">
                  {s.oferta
                    ? `${TIPO_BEM[s.oferta.tipoBem] ?? s.oferta.tipoBem} · carta ${brl(s.oferta.valorCarta)} · valor líquido da proposta ${brl(s.oferta.valorLiquido)}`
                    : 'Proposta ainda não enviada'}
                </span>
                <span className="block font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep mt-2">
                  Abrir acompanhamento →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {compacto && estado.tipo === 'ok' && estado.itens.length > 3 && (
        <p className="mt-3">
          <Link href="/vender/minhas" className="font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep">
            Ver todas ({estado.itens.length})
          </Link>
        </p>
      )}
    </section>
  );
}
