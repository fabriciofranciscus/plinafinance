/**
 * /historico (spec de UX da Íris, §3): lista cronológica única dos dois lados,
 * cada linha com data, valor, situação e link da transação. Apresentação pura.
 */

import Link from 'next/link';
import { explorerTx, fmtBrl, fmtDataHora, fmtTokens, hashCurto } from '@/lib/me/formato';
import { ROTULO_EVENTO, ROTULO_SITUACAO } from '@/lib/me/vocabulario';
import type { EventoHistorico } from '@/lib/me/tipos';

export type FiltroHistorico = 'tudo' | 'vender' | 'investir';

export interface EstadoHistorico {
  carregando: boolean;
  /** Falha ao carregar a primeira página (a lista ainda não existe). */
  erro: boolean;
  itens: EventoHistorico[];
  temMais: boolean;
  carregandoMais: boolean;
  /** Falha ao carregar mais: a lista permanece. */
  erroMais: boolean;
}

const ROTULO = 'font-details text-[10px] tracking-[0.2em] uppercase text-base/70';
const LINK =
  'inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-primary-deep';

const rotuloDoEvento = (e: EventoHistorico) =>
  e.tipo === 'pix_enviado' && e.simulado ? `${ROTULO_EVENTO.pix_enviado} (simulado)` : ROTULO_EVENTO[e.tipo];

function valorDoEvento(e: EventoHistorico): string {
  if (e.tipo === 'entrada_no_pool') return `${fmtBrl(e.valorBrl)} → ${fmtTokens(e.tokens)} PLINA-RF`;
  if (e.tipo === 'saida_do_pool') return `${fmtTokens(e.tokens)} PLINA-RF → ${fmtBrl(e.valorBrl)}`;
  return e.valorBrl ? fmtBrl(e.valorBrl) : '';
}

const linkInterno = (e: EventoHistorico) =>
  e.link ? { href: e.link, rotulo: e.link.startsWith('/cessao/') ? 'Ver comprovante →' : 'Abrir acompanhamento →' } : null;

function Transacao({ e }: { e: EventoHistorico }) {
  if (!e.txHash) return <span>Sem transação on-chain</span>;
  return (
    <a
      href={explorerTx(e.txHash)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Transação ${hashCurto(e.txHash)} no explorer, abre em nova aba`}
      className="font-mono underline text-primary-deep"
    >
      Transação {hashCurto(e.txHash)} ↗
    </a>
  );
}

const mesDe = (iso: string) => {
  const d = new Date(iso);
  return { chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, rotulo: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) };
};

function agrupar(itens: EventoHistorico[]) {
  const grupos: { chave: string; rotulo: string; itens: EventoHistorico[] }[] = [];
  for (const e of itens) {
    const m = mesDe(e.em);
    const g = grupos.find((x) => x.chave === m.chave);
    if (g) g.itens.push(e);
    else grupos.push({ ...m, itens: [e] });
  }
  return grupos;
}

export default function HistoricoView({
  estado,
  filtro,
  onFiltro,
  onTentarDeNovo,
  onCarregarMais,
  exemplo = false,
}: {
  estado: EstadoHistorico;
  filtro: FiltroHistorico;
  onFiltro: (f: FiltroHistorico) => void;
  onTentarDeNovo: () => void;
  onCarregarMais: () => void;
  exemplo?: boolean;
}) {
  const todos = estado.itens;
  const doisLados = todos.some((e) => e.lado === 'vender') && todos.some((e) => e.lado === 'investir');
  const visiveis = filtro === 'tudo' ? todos : todos.filter((e) => e.lado === filtro);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 md:py-14">
      {exemplo && (
        <p role="note" className="mb-6 border border-base/40 bg-document-grey/60 px-4 py-3 font-mono text-xs text-base">
          Dados de exemplo (fictícios). Esta tela ainda não está ligada à sua conta.
        </p>
      )}
      <header>
        <p className={ROTULO}>Histórico</p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-2">O que aconteceu na sua conta</h1>
      </header>

      {estado.carregando && (
        <p role="status" className="mt-8 font-text text-sm text-base/70">
          Carregando seu histórico…
        </p>
      )}

      {!estado.carregando && estado.erro && (
        <div role="alert" className="mt-8">
          <p className="font-text text-sm text-base/80">Não foi possível carregar seu histórico agora.</p>
          <button type="button" onClick={onTentarDeNovo} className={`${LINK} mt-2`}>
            Tentar de novo
          </button>
        </div>
      )}

      {!estado.carregando && !estado.erro && todos.length === 0 && (
        <div className="mt-8 max-w-xl">
          <p className="font-text text-sm text-base/80">
            Ainda não há eventos nesta conta. Quando você investir, sacar ou enviar uma cota, cada passo aparece aqui com a data e a
            transação.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-6">
            <Link href="/investir" className={LINK}>
              Investir (testnet) →
            </Link>
            <Link href="/vender" className={LINK}>
              Vender uma cota →
            </Link>
          </p>
        </div>
      )}

      {!estado.carregando && !estado.erro && todos.length > 0 && (
        <>
          {doisLados && (
            <div role="group" aria-label="Filtrar por lado" className="mt-8 flex flex-wrap gap-2">
              {(['tudo', 'vender', 'investir'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtro === f}
                  onClick={() => onFiltro(f)}
                  className={`min-h-[44px] px-4 font-details text-[10px] tracking-[0.2em] uppercase border ${
                    filtro === f ? 'bg-base text-lightBg border-base' : 'border-base/40 text-base'
                  }`}
                >
                  {f === 'tudo' ? 'Tudo' : f === 'vender' ? 'Vender' : 'Investir'}
                </button>
              ))}
            </div>
          )}

          {visiveis.length === 0 ? (
            <div className="mt-8">
              <p className="font-text text-sm text-base/80">Nenhum evento de {filtro === 'vender' ? 'Vender' : 'Investir'} nesta conta.</p>
              <button type="button" onClick={() => onFiltro('tudo')} className={`${LINK} mt-2`}>
                Ver tudo
              </button>
            </div>
          ) : (
            agrupar(visiveis).map((g) => (
              <section key={g.chave} aria-label={g.rotulo} className="mt-8">
                <h2 className={`${ROTULO} border-b border-light-hairline pb-2`}>{g.rotulo}</h2>

                {/* Celular e tablet: pilha */}
                <ol className="lg:hidden divide-y divide-light-hairline">
                  {g.itens.map((e) => (
                    <li key={e.id} className="py-4">
                      <p className="font-mono text-xs text-base/70">{fmtDataHora(e.em).replace(' ', ' · ')}</p>
                      <p className="font-text text-base font-medium mt-1">{rotuloDoEvento(e)}</p>
                      {(valorDoEvento(e) || e.referencia) && (
                        <p className="font-mono text-sm mt-1">
                          {[valorDoEvento(e), e.referencia ? `#${e.referencia}` : ''].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <p className="font-text text-sm text-base/80 mt-1">
                        {ROTULO_SITUACAO[e.situacao]} · <Transacao e={e} />
                      </p>
                      {e.situacao === 'falhou' && e.motivo && <p className="font-text text-sm text-base/80 mt-1">{e.motivo}</p>}
                      {linkInterno(e) && (
                        <Link href={linkInterno(e)!.href} className={LINK}>
                          {linkInterno(e)!.rotulo}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>

                {/* Desktop: tabela de quatro colunas */}
                <table className="hidden lg:table w-full mt-2 font-text text-sm">
                  <caption className="sr-only">Eventos de {g.rotulo}</caption>
                  <thead>
                    <tr className="text-left">
                      <th scope="col" className={`${ROTULO} py-2 pr-4 font-normal`}>Data</th>
                      <th scope="col" className={`${ROTULO} py-2 pr-4 font-normal`}>Evento</th>
                      <th scope="col" className={`${ROTULO} py-2 pr-4 font-normal text-right`}>Valor</th>
                      <th scope="col" className={`${ROTULO} py-2 font-normal`}>Situação e transação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-light-hairline">
                    {g.itens.map((e) => (
                      <tr key={e.id} className="align-top">
                        <td className="py-3 pr-4 font-mono text-xs whitespace-nowrap">{fmtDataHora(e.em)}</td>
                        <td className="py-3 pr-4">
                          {rotuloDoEvento(e)}
                          {e.referencia && <span className="font-mono text-xs text-base/70"> · #{e.referencia}</span>}
                          {linkInterno(e) && (
                            <div>
                              <Link href={linkInterno(e)!.href} className={LINK}>
                                {linkInterno(e)!.rotulo}
                              </Link>
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 font-mono text-right whitespace-nowrap">{valorDoEvento(e)}</td>
                        <td className="py-3">
                          {ROTULO_SITUACAO[e.situacao]} · <Transacao e={e} />
                          {e.situacao === 'falhou' && e.motivo && <div className="text-base/80">{e.motivo}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}

          {estado.erroMais ? (
            <div role="alert" className="mt-6">
              <p className="font-text text-sm text-base/80">Não foi possível carregar mais eventos agora.</p>
              <button type="button" onClick={onCarregarMais} className={`${LINK} mt-2`}>
                Tentar de novo
              </button>
            </div>
          ) : (
            estado.temMais && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={onCarregarMais}
                  disabled={estado.carregandoMais}
                  className="min-h-[44px] border border-base px-5 font-details text-[10px] tracking-[0.2em] uppercase text-base disabled:opacity-50"
                >
                  {estado.carregandoMais ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}
