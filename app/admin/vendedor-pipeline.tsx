'use client';

/**
 * Solicitações de venda no /admin (spec de UX da Íris, item 14): lista (tabela no desktop, três linhas no celular) +
 * detalhe com stepper vertical. SÓ a etapa "Agora" tem controles; as feitas mostram data e evidência; as futuras, só o
 * rótulo e a pré-condição. As ACTIONS são as de POST /api/admin/originacao (a API não mudou); a regra do que mostrar
 * está em lib/admin/etapas-operador.ts e a tradução dos erros em lib/admin/erro-acao.ts.
 *
 * Fluxo da cota de prova (Atlas/Bento): gerar proposta → registrar cessão → registrar laudo (URL com #sha256) →
 * enviar à assinatura → sincronizar assinatura → confirmar titular → registrar anuência → pagar cedente → incorporar.
 * O Pix simulado avulso saiu da rota (400): o único pagamento é `pagar-cedente`.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NOME_EM_ANDAMENTO, etapasDoLead, ordenarSolicitacoes, type AnaliseSolicitacao, type EtapaOperador } from '@/lib/admin/etapas-operador';
import { avisoDeResposta, interpretarErroDeAcao, oQueFazer, TEXTO_INCERTO, type ErroDeAcao } from '@/lib/admin/erro-acao';
import type { LeadAdmin } from '@/lib/admin/tipos';
import { semNotacaoCientifica } from '@/lib/format/campo-numerico';
import { AcaoComRevisao, nomeDaRede, type ConteudoRevisao, type LinhaRevisao } from './revisao-acao';

type PipelineLead = LeadAdmin;

const ROTULO_ANUENCIA: Record<string, string> = {
  DECLARADA_PENDENTE: 'declarada, pendente (simulada)',
  CONFIRMADA: 'confirmada pela administradora',
};

const ROTULO_TITULAR: Record<string, string> = {
  TITULAR_UNICO: 'titular único',
  ESPOLIO: 'espólio',
  COTITULARIDADE: 'cotitularidade',
  PROCURADOR: 'procurador',
};

const ROTULO_TIPO_BEM: Record<string, string> = { IMOVEL: 'Imóvel', VEICULO: 'Veículo', EQUIPAMENTO: 'Equipamento', SERVICO: 'Serviço' };

const BTN =
  'w-full lg:w-auto min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50';
const BTN_SECUNDARIO =
  'w-full lg:w-auto min-h-[44px] border border-base text-base font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-document-grey/60 transition-colors disabled:opacity-50';
const ROTULO = 'font-details text-[10px] tracking-[0.2em] uppercase text-base/70';

/** Verbo no gerúndio enquanto a ação roda (checklist do item 14). */
const GERUNDIO: Record<string, string> = {
  'gerar-oferta': 'Gerando…',
  'registrar-cessao': 'Registrando…',
  'registrar-laudo': 'Registrando…',
  'enviar-cessao': 'Enviando…',
  'sincronizar-cessoes': 'Sincronizando…',
  'confirmar-titular-laudo': 'Confirmando…',
  'registrar-anuencia': 'Registrando…',
  'pagar-cedente': 'Pagando…',
  'reabrir-pagamento-cedente': 'Reabrindo…',
  'incorporar-cota': 'Incorporando…',
};

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
const curto = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
const fmtData = (d: string | Date | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Id curto para o operador citar um lead sem copiar o id inteiro (os 6 últimos caracteres do id). */
export function idCurto(id: string): string {
  return id.slice(-6).toUpperCase();
}

const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brlDe = (v: { toString(): string } | null | undefined) => {
  const n = Number(v?.toString());
  return Number.isFinite(n) ? BRL.format(n) : '—';
};

function valorDoLead(lead: PipelineLead): string {
  const o = lead.ofertas[0];
  if (!o) return 'sem proposta';
  const n = Number(o.valorCarta.toString());
  return Number.isFinite(n) ? BRL_INTEIRO.format(n) : 'sem proposta';
}

/** Nome para a lista: e-mail ou marcador nunca ocupam o lugar do nome. */
function nomeDoLead(lead: PipelineLead): string {
  const n = lead.nome?.trim();
  return !n || n.includes('@') || n === 'Nome não informado' ? 'Nome não informado' : n;
}

type Filtro = 'abertas' | 'concluidas' | 'encerradas';

/** `redePublica`: a rede é a PUBLIC (mainnet). Sem ela, a tela trata tudo como rede de testes (simulado). */
export function VendedorPipeline({ leads, redePublica = false }: { leads: PipelineLead[]; redePublica?: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [selecionado, setSelecionado] = useState<string | null>(null);

  // `#lead-<id>` na URL abre o detalhe daquele lead: na carga e quando o hash muda com a página aberta (AP-3).
  useEffect(() => {
    const abrirDoHash = () => {
      const m = /^#lead-(.+)$/.exec(window.location.hash);
      if (m && leads.some((l) => l.id === m[1])) {
        setSelecionado(m[1]!);
        const l = leads.find((x) => x.id === m[1])!;
        const est = etapasDoLead(l, { redePublica }).estado;
        setFiltro(est === 'concluida' ? 'concluidas' : est === 'encerrada' ? 'encerradas' : 'abertas');
      }
    };
    abrirDoHash();
    window.addEventListener('hashchange', abrirDoHash);
    return () => window.removeEventListener('hashchange', abrirDoHash);
  }, [leads, redePublica]);

  const todas = ordenarSolicitacoes(leads, { redePublica }).map((l) => ({ lead: l, analise: etapasDoLead(l, { redePublica }) }));
  const grupo = (f: Filtro) =>
    todas.filter(({ analise }) => (f === 'abertas' ? analise.estado === 'aberta' || analise.estado === 'manual' : f === 'concluidas' ? analise.estado === 'concluida' : analise.estado === 'encerrada'));
  const contagem = { abertas: grupo('abertas').length, concluidas: grupo('concluidas').length, encerradas: grupo('encerradas').length };
  const visiveis = grupo(filtro);
  const atual = todas.find((t) => t.lead.id === selecionado) ?? null;

  if (leads.length === 0) {
    return (
      <p className="font-text text-sm text-base/70">
        Nenhuma solicitação aberta. Quando alguém enviar uma cota em <code className="font-mono text-xs">/vender</code>, ela aparece aqui.
      </p>
    );
  }

  function selecionar(id: string) {
    setSelecionado(id);
    window.history.replaceState(null, '', `#lead-${id}`);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className={`${atual ? 'hidden lg:block' : ''} min-w-0 lg:col-span-7`}>
        <div role="group" aria-label="Filtrar solicitações" className="flex flex-wrap gap-2 mb-4">
          {(['abertas', 'concluidas', 'encerradas'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
              className={`min-h-[44px] px-4 font-details text-[10px] tracking-[0.2em] uppercase border ${filtro === f ? 'bg-base text-lightBg border-base' : 'border-base/40 text-base'}`}
            >
              {f === 'abertas' ? 'Abertas' : f === 'concluidas' ? 'Concluídas' : 'Encerradas'} ({contagem[f]})
            </button>
          ))}
        </div>

        {visiveis.length === 0 ? (
          <p className="font-text text-sm text-base/70">
            {filtro === 'abertas' ? 'Nenhuma solicitação aberta.' : `Nenhuma solicitação ${filtro === 'concluidas' ? 'concluída' : 'encerrada'}.`}
          </p>
        ) : (
          <>
            {/* Desktop: tabela semântica */}
            <table data-testid="lista-tabela" className="hidden lg:table w-full table-fixed font-text text-sm">
              <caption className="sr-only">Solicitações de venda</caption>
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[27%]" />
                <col className="w-[17%]" />
                <col className="w-[22%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="text-left">
                  <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>ID</th>
                  <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>Cedente</th>
                  <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>Valor da carta</th>
                  <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>Etapa</th>
                  <th scope="col" className={`${ROTULO} py-2 font-normal`}>Próxima ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-hairline">
                {visiveis.map(({ lead, analise }) => (
                  <tr key={lead.id} className={`align-top ${lead.id === selecionado ? 'bg-document-grey/60' : ''}`}>
                    <td className="py-3 pr-3 font-mono text-xs">
                      <a
                        href={`#lead-${lead.id}`}
                        aria-current={lead.id === selecionado ? 'true' : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          selecionar(lead.id);
                        }}
                        className="inline-flex min-h-[44px] items-center underline text-primary-deep"
                      >
                        {idCurto(lead.id)}
                      </a>
                      {lead.id === selecionado && <span className="ml-2 font-details text-[10px] uppercase">Selecionado</span>}
                    </td>
                    <td className="py-3 pr-3">
                      {nomeDoLead(lead)}
                      <div className="font-mono text-xs text-base/70 break-all">{lead.email}</div>
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs whitespace-nowrap">{valorDoLead(lead)}</td>
                    <td className="py-3 pr-3 text-xs">{rotuloEtapa(analise)}</td>
                    <td className={`py-3 text-xs ${analise.dependeDe === 'operador' ? 'text-base font-medium' : 'text-base/60'}`}>
                      {analise.proximaAcao}
                      {analise.dependeDe === 'operador' && <span aria-hidden="true"> →</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Celular e tablet: três linhas por solicitação, alvo de 72 px */}
            <ul data-testid="lista-mobile" className="lg:hidden divide-y divide-light-hairline border border-light-hairline bg-white">
              {visiveis.map(({ lead, analise }) => (
                <li key={lead.id}>
                  <button type="button" onClick={() => selecionar(lead.id)} className="block w-full min-h-[72px] px-4 py-3 text-left">
                    <span className="block font-text text-sm font-semibold">
                      <span className="font-mono text-xs">{idCurto(lead.id)}</span> · {nomeDoLead(lead)}
                    </span>
                    <span className="block font-mono text-xs text-base/70 mt-1">
                      {valorDoLead(lead)} · {rotuloEtapa(analise)}
                    </span>
                    <span className={`block font-text text-sm mt-1 ${analise.dependeDe === 'operador' ? 'text-base' : 'text-base/60'}`}>
                      {analise.proximaAcao}
                      {analise.dependeDe === 'operador' && <span aria-hidden="true"> →</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className={`${atual ? '' : 'hidden lg:block'} min-w-0 lg:col-span-5`}>
        {atual ? (
          <DetalheSolicitacao key={atual.lead.id} lead={atual.lead} analise={atual.analise} redePublica={redePublica} onVoltar={() => setSelecionado(null)} />
        ) : (
          <p className="font-text text-sm text-base/70">Escolha uma solicitação na lista.</p>
        )}
      </div>
    </div>
  );
}

function rotuloEtapa(a: AnaliseSolicitacao): string {
  if (a.atual) return `${a.atual} · ${NOME_EM_ANDAMENTO[a.etapas[a.atual - 1]!.id]}`;
  if (a.estado === 'concluida') return 'Concluída';
  if (a.estado === 'encerrada') return 'Encerrada';
  if (a.estado === 'manual') return 'Tratamento manual';
  return '—';
}

// ─── Detalhe: stepper vertical ──────────────────────────────────────────────────────────────────

function DetalheSolicitacao({
  lead,
  analise,
  redePublica,
  onVoltar,
}: {
  lead: PipelineLead;
  analise: AnaliseSolicitacao;
  redePublica: boolean;
  onVoltar: () => void;
}) {
  const router = useRouter();
  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  const [executando, setExecutando] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroDeAcao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState('');
  const [feitasAbertas, setFeitasAbertas] = useState(false);
  const voltarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Celular recolhe as concluídas; desktop mostra (data e evidência preservadas).
    if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches) setFeitasAbertas(true);
  }, []);

  async function executar(action: string, payload: Record<string, unknown>) {
    setExecutando(action);
    setErro(null);
    setAviso(null);
    try {
      const res = await fetch('/api/admin/originacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-plina-admin': '1' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        setErro(interpretarErroDeAcao(res.status, corpo, res.headers.get('retry-after')));
        return;
      }
      // 200 nem sempre é o passo concluído (sincronizar, pagar): lê o corpo e avisa quando ainda não avançou.
      const ok = await res.json().catch(() => null);
      setAviso(avisoDeResposta(action, ok));
      router.refresh();
    } catch {
      // Rede/timeout sem resposta: o resultado é incerto (a ação pode ter ocorrido).
      setErro({ texto: TEXTO_INCERTO, codigo: null, incerto: true });
    } finally {
      setExecutando(null);
    }
  }

  async function copiar(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiado(hash);
      setTimeout(() => setCopiado(''), 2000);
    } catch {
      /* sem permissão de área de transferência: o hash continua selecionável */
    }
  }

  const feitas = analise.etapas.filter((e) => e.situacao === 'feita');
  const demais = analise.etapas.filter((e) => e.situacao !== 'feita');
  const rotuloEstado = rotuloEtapa(analise);

  return (
    <section data-testid="detalhe" aria-label={`Solicitação ${idCurto(lead.id)}`} className="border border-light-hairline bg-white p-4 lg:sticky lg:top-24">
      <button ref={voltarRef} type="button" onClick={onVoltar} className={`lg:hidden min-h-[44px] -ml-1 mb-2 ${ROTULO} underline underline-offset-4`}>
        ← Solicitações
      </button>
      <p className={ROTULO}>Solicitação #{idCurto(lead.id)}</p>
      <h3 className="font-title text-xl font-semibold mt-1">{rotuloEstado}</h3>
      <p className="font-text text-sm mt-2">
        {nomeDoLead(lead)} · <span className="font-mono text-xs">{lead.email}</span>
      </p>
      {oferta && (
        <p className="font-mono text-xs text-base/70 mt-1">
          {ROTULO_TIPO_BEM[oferta.tipoBem] ?? oferta.tipoBem} · carta {BRL_INTEIRO.format(Number(oferta.valorCarta.toString()))} · líquido{' '}
          {BRL_INTEIRO.format(Number(oferta.valorLiquidoVendedor.toString()))} · {oferta.administradora}
        </p>
      )}
      {analise.pausa && <p className="font-text text-sm text-base/80 mt-3">{analise.pausa}</p>}

      <details open={feitasAbertas} onToggle={(e) => setFeitasAbertas((e.currentTarget as HTMLDetailsElement).open)} className="mt-4">
        <summary className={`min-h-[44px] flex items-center cursor-pointer ${ROTULO}`}>Etapas concluídas ({feitas.length})</summary>
        <ol className="divide-y divide-light-hairline">
          {feitas.map((e) => (
            <li key={e.id} className="py-3 font-text text-sm">
              <p>
                <span aria-hidden="true">✓ </span>
                <span className="font-mono text-xs text-base/70">{e.n}</span> {e.rotulo}
                {e.data && <span className="font-mono text-xs text-base/70"> · {fmtData(e.data)}</span>}
                {!e.data && e.id === 'aceite' && <span className="font-text text-xs text-base/70"> · data do aceite não disponível</span>}
              </p>
              <Evidencia etapa={e} copiado={copiado} onCopiar={copiar} comprovanteDe={e.id === 'assinatura' ? cessao?.id : undefined} />
            </li>
          ))}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">{copiado ? 'Copiado' : ''}</p>
      </details>

      <ol className="mt-2 divide-y divide-light-hairline">
        {demais.map((e) =>
          e.situacao === 'agora' ? (
            <li key={e.id} data-testid="etapa-agora" aria-current="step" className="py-4">
              <p className="font-text text-sm font-semibold">
                <span className="font-mono text-xs">● {e.n}</span> {tituloAgora(e, analise, redePublica)}{' '}
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">Agora</span>
              </p>
              <ControlesDaEtapa
                etapa={e}
                lead={lead}
                analise={analise}
                redePublica={redePublica}
                executando={executando}
                onExecutar={executar}
              />
              {aviso && (
                <p role="status" data-testid="aviso-acao" className="mt-3 font-text text-sm text-base/80">
                  {aviso}
                </p>
              )}
              {erro && (
                <div role="alert" className="mt-3">
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-red-700">{erro.incerto ? 'Sem confirmação' : 'Não concluído'}</p>
                  <p className="font-text text-sm text-red-700 mt-1">{erro.texto}</p>
                  {oQueFazer(erro.codigo) && <p className="font-text text-sm text-base mt-1">{oQueFazer(erro.codigo)}</p>}
                  {erro.codigo && <p className="font-mono text-[11px] text-base/70 mt-1">{erro.codigo}</p>}
                  {erro.texto.startsWith('Sessão expirada') && (
                    <p className="mt-1">
                      <a href="/admin" className="underline text-primary-deep font-text text-sm">Entrar de novo</a>
                    </p>
                  )}
                </div>
              )}
            </li>
          ) : (
            <li key={e.id} className="py-3 font-text text-sm text-base/70">
              <span aria-hidden="true">○ </span>
              <span className="font-mono text-xs">{e.n}</span> {e.rotulo}
              {e.depoisDe && <span> — {e.depoisDe}</span>}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function tituloAgora(e: EtapaOperador, a: AnaliseSolicitacao, redePublica: boolean): string {
  if (e.id === 'pagamento') {
    if (a.pagamento === 'reabrir') return 'Reabrir pagamento';
    if (a.pagamento === 'reconsultar') return 'Pagamento em andamento';
    return redePublica ? 'Pagar cedente' : 'Pagar cedente (Pix simulado, rede de testes)';
  }
  const titulo: Record<string, string> = {
    proposta: 'Gerar proposta',
    aceite: 'Aguardando o cedente',
    cessao: 'Registrar cessão',
    laudo: 'Registrar laudo',
    envio: 'Enviar para assinatura',
    assinatura: 'Aguardando a assinatura do cedente',
    titular: 'Confirmar titular do laudo',
    anuencia: 'Anuência da administradora',
    incorporacao: 'Incorporar cota ao pool · emitir PLINA-RF',
  };
  return titulo[e.id] ?? e.rotulo;
}

function Evidencia({
  etapa,
  copiado,
  onCopiar,
  comprovanteDe,
}: {
  etapa: EtapaOperador;
  copiado: string;
  onCopiar: (h: string) => void;
  comprovanteDe?: string;
}) {
  const ev = etapa.evidencia;
  if (!ev) return null;
  return (
    <p className="mt-1 font-mono text-xs text-base/80 break-all">
      {ev.tx && (
        <>
          tx{' '}
          <a href={explorerTx(ev.tx)} target="_blank" rel="noopener noreferrer" aria-label={`Transação ${curto(ev.tx)} no explorer, abre em nova aba`} className="underline text-primary-deep">
            {curto(ev.tx)} ↗
          </a>{' '}
          <button type="button" onClick={() => onCopiar(ev.tx!)} className="min-h-[44px] px-2 underline" aria-label={`Copiar a transação ${curto(ev.tx)}`}>
            {copiado === ev.tx ? 'Copiado' : 'copiar'}
          </button>
        </>
      )}
      {ev.hash && (
        <>
          sha256 {curto(ev.hash)}{' '}
          <button type="button" onClick={() => onCopiar(ev.hash!)} className="min-h-[44px] px-2 underline" aria-label={`Copiar o hash ${curto(ev.hash)}`}>
            {copiado === ev.hash ? 'Copiado' : 'copiar'}
          </button>
        </>
      )}
      {ev.texto && <>{rotuloDeEvidencia(etapa.id, ev.texto)}</>}
      {comprovanteDe && (
        <>
          {' '}
          · <a href={`/cessao/${comprovanteDe}/comprovante`} className="underline text-primary-deep">Ver comprovante</a>
        </>
      )}
    </p>
  );
}

function rotuloDeEvidencia(id: string, texto: string): string {
  if (id === 'titular') return ROTULO_TITULAR[texto] ?? texto;
  if (id === 'anuencia') return ROTULO_ANUENCIA[texto] ?? texto;
  return texto;
}

// ─── Revisão das ações irreversíveis ───────────────────────────────────────────────────────────

/** Quem e o quê a ação atinge: o mesmo resumo em todas as etapas, para o operador conferir o lead antes de agir. */
function linhasDoLead(lead: PipelineLead, redePublica: boolean): LinhaRevisao[] {
  const o = lead.ofertas[0];
  return [
    { rotulo: 'Solicitação', valor: <span className="font-mono">{idCurto(lead.id)}</span> },
    { rotulo: 'Cedente', valor: `${lead.nome} · ${lead.email}` },
    ...(o
      ? [
          { rotulo: 'Cota', valor: `${ROTULO_TIPO_BEM[o.tipoBem] ?? o.tipoBem} · ${o.administradora}` },
          { rotulo: 'Valor da carta', valor: <span className="font-mono">{brlDe(o.valorCarta)}</span> },
          { rotulo: 'Valor ao cedente', valor: <span className="font-mono">{brlDe(o.valorLiquidoVendedor)}</span> },
        ]
      : []),
    { rotulo: 'Rede', valor: nomeDaRede(redePublica) },
  ];
}

function revisaoDe(
  acao: 'registrar-cessao' | 'registrar-laudo' | 'enviar-cessao' | 'registrar-anuencia' | 'pagar-cedente' | 'reabrir-pagamento-cedente' | 'incorporar-cota',
  lead: PipelineLead,
  redePublica: boolean,
  extra: LinhaRevisao[] = [],
): ConteudoRevisao {
  const linhas = [...linhasDoLead(lead, redePublica), ...extra];
  const rede = nomeDaRede(redePublica);
  switch (acao) {
    case 'registrar-cessao':
      return {
        titulo: 'Revisar antes de registrar a cessão',
        linhas,
        consequencia: 'Registra a cessão desta proposta e envia o termo ao cedente para assinatura (DocuSign). O cedente recebe o e-mail na hora; não há como cancelar o envio por aqui.',
        atesto: 'Conferi o cedente, a cota e o valor, e entendo que o termo será enviado para assinatura.',
        confirmar: 'Registrar e enviar',
      };
    case 'enviar-cessao':
      return {
        titulo: 'Revisar antes de enviar para assinatura',
        linhas,
        consequencia: 'Envia o termo de cessão ao cedente pelo DocuSign. O cedente recebe o e-mail na hora; não há como cancelar o envio por aqui.',
        atesto: 'Conferi o cedente, a cota e o valor, e entendo que o termo será enviado para assinatura.',
        confirmar: 'Enviar para assinatura',
      };
    case 'registrar-laudo':
      return {
        titulo: 'Revisar antes de registrar o laudo',
        linhas,
        consequencia: `Grava o hash do laudo na ${rede}. O registro é público e não pode ser apagado; um laudo errado exige um novo registro.`,
        atesto: `Conferi o laudo e a cessão, e entendo que o hash fica registrado na ${rede}.`,
        confirmar: 'Registrar laudo',
      };
    case 'registrar-anuencia':
      return {
        titulo: 'Revisar antes de registrar a anuência',
        linhas,
        consequencia: 'Registra a anuência da administradora na auditoria desta cessão. Ela libera o pagamento ao cedente; um registro novo substitui este, mas os dois ficam no histórico.',
        atesto: 'Conferi a cessão, o tipo de anuência e a referência.',
        confirmar: 'Registrar anuência',
      };
    case 'pagar-cedente':
      return {
        titulo: 'Revisar antes de pagar',
        linhas,
        consequencia: redePublica
          ? 'Envia o Pix do valor ao cedente para a chave do cadastro dele. Pix enviado não volta.'
          : 'Envia o Pix simulado do valor ao cedente, na rede de testes. Na rede principal, esta ação envia um Pix real.',
        atesto: 'Conferi o cedente e o valor do pagamento.',
        confirmar: redePublica ? 'Pagar cedente' : 'Pagar cedente (Pix simulado)',
      };
    case 'reabrir-pagamento-cedente':
      return {
        titulo: 'Revisar antes de reabrir o pagamento',
        linhas,
        consequencia: 'Reabre o pagamento para um novo envio do Pix ao mesmo destino do cadastro. A decisão fica registrada na auditoria.',
        atesto: 'Conferi que o Pix anterior falhou e que o cedente e o valor estão certos.',
        confirmar: 'Reabrir pagamento',
      };
    case 'incorporar-cota':
      return {
        titulo: 'Revisar antes de incorporar a cota',
        linhas,
        consequencia: `Incorpora a cota ao pool e emite PLINA-RF na ${rede}, ao NAV do momento. Token emitido não volta sem uma queima registrada.`,
        atesto: `Conferi a cota e o valor, e entendo que a emissão fica registrada na ${rede}.`,
        confirmar: 'Incorporar e emitir',
      };
  }
}

// ─── Controles de cada etapa "Agora" ───────────────────────────────────────────────────────────

function ControlesDaEtapa({
  etapa,
  lead,
  analise,
  redePublica,
  executando,
  onExecutar,
}: {
  etapa: EtapaOperador;
  lead: PipelineLead;
  analise: AnaliseSolicitacao;
  redePublica: boolean;
  executando: string | null;
  onExecutar: (action: string, payload: Record<string, unknown>) => void;
}) {
  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  const [laudoUrl, setLaudoUrl] = useState('');
  const [situacao, setSituacao] = useState('TITULAR_UNICO');
  const [atestado, setAtestado] = useState(false);
  const [anuenciaTipo, setAnuenciaTipo] = useState(redePublica ? 'CONFIRMADA' : 'DECLARADA_PENDENTE');
  const [anuenciaRef, setAnuenciaRef] = useState('');
  const ocupado = executando !== null;
  const rotulo = (action: string, normal: string) => (executando === action ? GERUNDIO[action] : normal);
  const processando = executando && (
    <p role="status" className="mt-2 font-text text-xs text-base/70">
      Processando. Aguarde a confirmação antes de repetir.
    </p>
  );

  switch (etapa.id) {
    case 'proposta':
      return <NovaOfertaForm leadId={lead.id} onSubmit={(a, p) => onExecutar(a, p)} busy={ocupado} />;

    case 'aceite':
      return (
        <p className="mt-2 font-text text-sm text-base/70">
          Aguardando o cedente{oferta?.validade ? ` · válida até ${fmtData(oferta.validade as string | Date)}` : ''}.
        </p>
      );

    case 'cessao':
      return (
        <div className="mt-2">
          <AcaoComRevisao
            className={BTN}
            desabilitado={ocupado}
            rotulo={rotulo('registrar-cessao', 'Registrar cessão')}
            revisao={revisaoDe('registrar-cessao', lead, redePublica)}
            onExecutar={() => onExecutar('registrar-cessao', { ofertaId: oferta!.id })}
          />
          {processando}
        </div>
      );

    case 'laudo':
      return (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className={ROTULO}>URL do laudo (com #sha256 do documento)</span>
            <input
              type="url"
              value={laudoUrl}
              onChange={(e) => setLaudoUrl(e.target.value)}
              placeholder="https://…/laudo.pdf#sha256=…"
              className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-mono text-xs"
            />
            <span className="mt-1 block font-text text-xs text-base/70">
              O laudo precisa ter o item 7 (quitação): saldo devedor R$ 0,00, conforme documento da administradora (na testnet, o documento de teste
              rotulado). Sem dado pessoal.
            </span>
          </label>
          <AcaoComRevisao
            className={BTN}
            desabilitado={ocupado || !/^https?:\/\//.test(laudoUrl.trim())}
            describedBy="razao-laudo"
            rotulo={rotulo('registrar-laudo', 'Registrar laudo')}
            revisao={revisaoDe('registrar-laudo', lead, redePublica, [
              { rotulo: 'Laudo', valor: <span className="break-all font-mono text-sm">{laudoUrl.trim()}</span> },
            ])}
            onExecutar={() => onExecutar('registrar-laudo', { cessaoId: cessao!.id, laudoUrl: laudoUrl.trim() })}
          />
          {!/^https?:\/\//.test(laudoUrl.trim()) && (
            <p id="razao-laudo" className="font-text text-xs text-base/70">Informe a URL do laudo (começando com http ou https).</p>
          )}
          {processando}
        </div>
      );

    case 'envio':
      return (
        <div className="mt-2">
          <p className="font-text text-xs text-base/70 mb-2">Laudo registrado. Falta enviar à assinatura.</p>
          <AcaoComRevisao
            className={BTN}
            desabilitado={ocupado}
            rotulo={rotulo('enviar-cessao', 'Enviar para assinatura (DocuSign)')}
            revisao={revisaoDe('enviar-cessao', lead, redePublica)}
            onExecutar={() => onExecutar('enviar-cessao', { cessaoId: cessao!.id })}
          />
          {processando}
        </div>
      );

    case 'assinatura':
      return (
        <div className="mt-2">
          <p data-testid="cessao-aguardando-assinatura" className="font-text text-sm text-base/70 mb-2">
            Aguardando assinatura do cedente.
          </p>
          <button type="button" disabled={ocupado} onClick={() => onExecutar('sincronizar-cessoes', { cessaoId: cessao!.id })} className={BTN_SECUNDARIO}>
            {rotulo('sincronizar-cessoes', 'Sincronizar assinatura')}
          </button>
        </div>
      );

    case 'titular':
      return (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className={ROTULO}>Titular confirmado no laudo</span>
            <select
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
              className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-text text-sm"
            >
              <option value="TITULAR_UNICO">Titular único</option>
              <option value="ESPOLIO">Espólio</option>
              <option value="COTITULARIDADE">Cotitularidade</option>
              <option value="PROCURADOR">Procurador</option>
            </select>
          </label>
          <label className="flex min-h-[44px] items-start gap-2 font-text text-xs text-base/80">
            <input type="checkbox" checked={atestado} onChange={(e) => setAtestado(e.target.checked)} className="mt-0.5 w-5 h-5 accent-primary-deep" />
            Atesto que o titular indicado no laudo é o titular do CPF do cadastro do cedente (na testnet, o cedente fictício do documento de teste).
          </label>
          <button
            type="button"
            disabled={ocupado || !atestado}
            aria-describedby="razao-titular"
            onClick={() => onExecutar('confirmar-titular-laudo', { cessaoId: cessao!.id, situacao, atestado })}
            className={BTN}
          >
            {rotulo('confirmar-titular-laudo', 'Confirmar titular do laudo')}
          </button>
          {!atestado && (
            <p id="razao-titular" className="font-text text-xs text-base/70">Marque o atesto para confirmar o titular.</p>
          )}
          {processando}
        </div>
      );

    case 'anuencia':
      return (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className={ROTULO}>Anuência da administradora</span>
            <select
              value={anuenciaTipo}
              onChange={(e) => setAnuenciaTipo(e.target.value)}
              className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-text text-sm"
            >
              {!redePublica && <option value="DECLARADA_PENDENTE">Declarada, pendente (anuência simulada na testnet)</option>}
              <option value="CONFIRMADA">Confirmada pela administradora</option>
            </select>
            <span className="mt-1 block font-text text-xs text-base/70">
              Na demonstração, usar “Declarada, pendente”. “Confirmada pela administradora” só com documento dela, e exige a referência.
            </span>
          </label>
          <label className="block">
            <span className={ROTULO}>{anuenciaTipo === 'CONFIRMADA' ? 'Referência do documento da administradora' : 'Referência (opcional)'}</span>
            <input
              type="text"
              maxLength={200}
              value={anuenciaRef}
              onChange={(e) => setAnuenciaRef(e.target.value)}
              className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-text text-sm"
            />
          </label>
          <AcaoComRevisao
            className={BTN}
            desabilitado={ocupado || (anuenciaTipo === 'CONFIRMADA' && !anuenciaRef.trim()) || !cessao?.laudoHash}
            describedBy="razao-anuencia"
            rotulo={rotulo('registrar-anuencia', 'Registrar anuência')}
            revisao={revisaoDe('registrar-anuencia', lead, redePublica, [
              { rotulo: 'Anuência', valor: ROTULO_ANUENCIA[anuenciaTipo] ?? anuenciaTipo },
              ...(anuenciaRef.trim() ? [{ rotulo: 'Referência', valor: anuenciaRef.trim() }] : []),
            ])}
            onExecutar={() =>
              onExecutar('registrar-anuencia', {
                hashValidacao: cessao!.laudoHash,
                status: anuenciaTipo,
                ...(anuenciaRef.trim() ? { referencia: anuenciaRef.trim() } : {}),
              })
            }
          />
          {!cessao?.laudoHash ? (
            <p id="razao-anuencia" className="font-text text-xs text-base/70">Falta o hash do laudo para registrar a anuência.</p>
          ) : anuenciaTipo === 'CONFIRMADA' && !anuenciaRef.trim() ? (
            <p id="razao-anuencia" className="font-text text-xs text-base/70">Informe a referência do documento da administradora.</p>
          ) : null}
          {processando}
        </div>
      );

    case 'pagamento':
      if (analise.pagamento === 'reabrir') {
        return (
          <div className="mt-2">
            <p className="font-text text-xs text-base/70 mb-2">O Pix falhou e foi confirmado pelo PSP. Reabrir pagamento é uma ação auditada.</p>
            <AcaoComRevisao
              className={BTN}
              desabilitado={ocupado}
              rotulo={rotulo('reabrir-pagamento-cedente', 'Reabrir pagamento')}
              revisao={revisaoDe('reabrir-pagamento-cedente', lead, redePublica)}
              onExecutar={() => onExecutar('reabrir-pagamento-cedente', { cessaoId: cessao!.id })}
            />
            {processando}
          </div>
        );
      }
      return (
        <div className="mt-2">
          {analise.pagamento === 'reconsultar' && (
            <p className="font-text text-xs text-base/70 mb-2">
              Pix em andamento ({cessao?.pixStatus}). Reconsultar não paga de novo.
            </p>
          )}
          {analise.pagamento === 'reconsultar' ? (
            // Reconsultar só lê a situação no PSP e não paga de novo: sem Revisão.
            <button type="button" disabled={ocupado} onClick={() => onExecutar('pagar-cedente', { cessaoId: cessao!.id })} className={BTN}>
              {executando === 'pagar-cedente' ? GERUNDIO['pagar-cedente'] : 'Reconsultar pagamento'}
            </button>
          ) : (
            <AcaoComRevisao
              className={BTN}
              desabilitado={ocupado}
              rotulo={
                executando === 'pagar-cedente'
                  ? GERUNDIO['pagar-cedente']
                  : redePublica
                    ? 'Pagar cedente (Pix)'
                    : 'Pagar cedente (Pix simulado, rede de testes)'
              }
              revisao={revisaoDe('pagar-cedente', lead, redePublica)}
              onExecutar={() => onExecutar('pagar-cedente', { cessaoId: cessao!.id })}
            />
          )}
          {processando}
        </div>
      );

    case 'incorporacao':
      return (
        <div className="mt-2">
          <AcaoComRevisao
            className={BTN}
            desabilitado={ocupado}
            rotulo={rotulo('incorporar-cota', 'Incorporar cota ao pool · emitir PLINA-RF')}
            revisao={revisaoDe('incorporar-cota', lead, redePublica)}
            onExecutar={() => onExecutar('incorporar-cota', { cessaoId: cessao!.id })}
          />
          {executando === 'incorporar-cota' && (
            <p role="status" className="mt-2 font-text text-xs text-base/70">Processando. Aguarde a confirmação antes de repetir.</p>
          )}
        </div>
      );

    default:
      return null;
  }
}

function NovaOfertaForm({
  leadId,
  onSubmit,
  busy,
}: {
  leadId: string;
  onSubmit: (action: string, payload: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erroPrevia, setErroPrevia] = useState<ErroDeAcao | null>(null);
  const [calculando, setCalculando] = useState(false);

  // O schema da rota exige number inteiro (z.number().int()) em prazoRestanteMeses; FormData devolve string.
  // valorCarta e desagioAquisicao ficam string de propósito: a rota os valida como NumericString.
  // 0 é válido: cota quitada, sem componente de prazo (Bento, A-01).
  const lerCampos = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const prazoTxt = String(fd.get('prazoRestanteMeses') ?? '').trim();
    return {
      tipoBem: fd.get('tipoBem'),
      valorCarta: fd.get('valorCarta'),
      administradora: fd.get('administradora'),
      desagioAquisicao: fd.get('desagioAquisicao'),
      prazoRestanteMeses: prazoTxt ? Number(prazoTxt) : undefined,
    };
  };

  // A-08: a prévia é a MESMA função do gerar-oferta (somente leitura, nada é gravado): o número bate.
  async function calcularPrevia() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const { tipoBem: _tipoBem, ...campos } = lerCampos(form);
    void _tipoBem;
    setCalculando(true);
    setErroPrevia(null);
    try {
      const res = await fetch('/api/admin/originacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-plina-admin': '1' },
        body: JSON.stringify({ action: 'previa-oferta', ...campos }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPrevia(null);
        setErroPrevia(interpretarErroDeAcao(res.status, corpo, res.headers.get('retry-after')));
        return;
      }
      setPrevia(corpo as Previa);
    } catch {
      setPrevia(null);
      setErroPrevia(interpretarErroDeAcao(0, null));
    } finally {
      setCalculando(false);
    }
  }

  return (
    <form
      ref={formRef}
      onChange={() => {
        // Mudou algum campo: a prévia antiga deixou de valer.
        setPrevia(null);
        setErroPrevia(null);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit('gerar-oferta', { leadVendedorId: leadId, ...lerCampos(e.currentTarget), validadeHoras: 48 });
      }}
      className="bg-document-grey/40 p-3 border border-light-hairline grid grid-cols-2 gap-2 items-end"
    >
      <Field label="Tipo">
        <select name="tipoBem" defaultValue="IMOVEL" required className={inputCls}>
          <option value="IMOVEL">Imóvel</option>
          <option value="VEICULO">Veículo</option>
          <option value="EQUIPAMENTO">Equipamento</option>
          <option value="SERVICO">Serviço</option>
        </select>
      </Field>
      <Field label="Valor carta">
        <input
          name="valorCarta"
          type="number"
          onKeyDown={semNotacaoCientifica}
          step="0.01"
          min="0.01"
          required
          placeholder="150000"
          className={inputCls + ' font-mono'}
        />
      </Field>
      <Field label="Administradora">
        <input
          name="administradora"
          type="text"
          required
          placeholder="Caixa"
          className={inputCls}
        />
      </Field>
      <Field label="Deságio">
        <input
          name="desagioAquisicao"
          type="number"
          onKeyDown={semNotacaoCientifica}
          step="0.0001"
          min="0"
          max="1"
          required
          placeholder="0.20"
          className={inputCls + ' font-mono'}
        />
      </Field>
      <Field label="Prazo restante (meses) — 0 = quitada">
        <input
          name="prazoRestanteMeses"
          type="number"
          onKeyDown={semNotacaoCientifica}
          min="0"
          max="600"
          step="1"
          placeholder="0"
          className={inputCls + ' font-mono'}
        />
      </Field>
      <div className="col-span-full grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void calcularPrevia()}
          disabled={busy || calculando}
          className="w-full min-h-[44px] border border-base text-base font-details text-[10px] tracking-[0.2em] uppercase px-3 py-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
        >
          {calculando ? 'Calculando…' : 'Ver prévia'}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="w-full min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-3 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
        >
          Gerar proposta
        </button>
      </div>
      <p className="col-span-full font-text text-xs text-base/70">
        Preencher o prazo aumenta o deságio da proposta (regra de originação).
      </p>
      {previa && (
        <p role="status" data-testid="previa-oferta" className="col-span-full font-mono text-xs text-base">
          Deságio final {pctDeFracao(previa.desagioTotal)} (base {pctDeFracao(previa.desagioBase)} + anuência{' '}
          {pctDeBps(previa.taxaAnuenciaBps)} + prazo {pctDeBps(previa.taxaPrazoBps)}) · Valor líquido ao cedente{' '}
          {brl2(previa.valorLiquido)}
        </p>
      )}
      {erroPrevia && (
        <div role="alert" className="col-span-full">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-red-700">{erroPrevia.incerto ? 'Sem confirmação' : 'Não concluído'}</p>
          <p className="font-text text-xs text-red-700 mt-1">{erroPrevia.texto}</p>
          {oQueFazer(erroPrevia.codigo) && <p className="font-text text-xs text-base mt-1">{oQueFazer(erroPrevia.codigo)}</p>}
          {erroPrevia.codigo ? <p className="font-mono text-[11px] text-base/70 mt-1">{erroPrevia.codigo}</p> : null}
        </div>
      )}
    </form>
  );
}

/** Resposta de POST /api/admin/originacao { action: 'previa-oferta' } (Bento, A-08): strings. */
interface Previa {
  desagioBase: string;
  taxaAnuenciaBps: string | number;
  taxaPrazoBps: string | number;
  desagioTotal: string;
  valorLiquido: string;
}

// Só EXIBIÇÃO: o servidor calculou tudo; aqui se troca fração por % e bps por %.
const pctDeFracao = (s: string) => `${(Number(s) * 100).toFixed(2).replace('.', ',')}%`;
const pctDeBps = (s: string | number) => `${(Number(s) / 100).toFixed(2).replace('.', ',')}%`;
const brl2 = (s: string) =>
  Number.isFinite(Number(s)) ? Number(s).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : s;

const inputCls =
  'w-full bg-white border border-light-hairline min-h-[44px] px-2 py-1.5 font-text text-xs focus:outline-none focus:ring-2 focus:ring-primary-deep';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-1 block">
        {label}
      </span>
      {children}
    </label>
  );
}
