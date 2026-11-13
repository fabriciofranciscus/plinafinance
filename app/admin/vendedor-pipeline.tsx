'use client';

/**
 * Pipeline kanban dos vendedores no /admin. Cada lead mostra estágio
 * atual + botão pra próxima ação. Fluxo da cota de prova (Atlas/Bento):
 * gerar oferta → registrar cessão (só cria, PENDENTE) → registrar laudo
 * (URL com #sha256) → enviar à assinatura (DocuSign) → sincronizar assinatura →
 * confirmar titular do laudo → pagar cedente → incorporar cota.
 * O Pix simulado avulso saiu da rota (400): o único pagamento é `pagar-cedente`.
 *
 * Cada ação chama /api/admin/originacao (server-side) e revalida via
 * router.refresh.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PipelineLead {
  id: string;
  nome: string;
  email: string;
  status: string;
  criadoEm: string | Date;
  ofertas: Array<{
    id: string;
    versao: number;
    tipoBem: string;
    valorCarta: string | number | { toString(): string };
    valorLiquidoVendedor: string | number | { toString(): string };
    desagioAquisicao: string | number | { toString(): string };
    administradora: string;
    status: string;
    validade: string | Date;
    cessao: {
      id: string;
      status: string;
      onChainTxHash: string | null;
      pagamento: {
        id: string;
        status: string;
        onChainTxHash: string | null;
      } | null;
      cota: { id: string } | null;
      /** Existe o laudo registrado (evento COTA_VALIDADA da cessão). */
      laudoRegistrado?: boolean;
      /** Titular confirmado no laudo (E1-2): null = ainda não confirmado. */
      titularSituacao?: string | null;
      /** Situação da transferência Pix da cessão (StatusTransferenciaPix), se existir. */
      pixStatus?: string | null;
      /** Hash do laudo (payloadHash do COTA_VALIDADA): é o `hashValidacao` da anuência. */
      laudoHash?: string | null;
      /** Anuência da administradora registrada (CONFIRMADA | DECLARADA_PENDENTE), se houver. */
      anuenciaStatus?: string | null;
    } | null;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  CONTATADO: 'Contatado',
  DOCS_SOLICITADOS: 'Docs solicitados',
  DOCS_RECEBIDOS: 'Docs recebidos',
  OFERTA_ENVIADA: 'Oferta enviada',
  OFERTA_ACEITA: 'Oferta aceita',
  CESSAO_ASSINADA: 'Cessão assinada',
  PIX_EXECUTADO: 'Pix executado',
  COTA_INCORPORADA: 'Cota incorporada',
  PERDIDO: 'Perdido',
};

const ROTULO_ANUENCIA: Record<string, string> = {
  DECLARADA_PENDENTE: 'declarada, pendente (simulada)',
  CONFIRMADA: 'confirmada pela administradora',
};

const BTN =
  'min-h-[44px] bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50';

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/** `redePublica`: a rede é a PUBLIC (mainnet). Sem ela, a tela trata tudo como rede de testes (simulado). */
export function VendedorPipeline({ leads, redePublica = false }: { leads: PipelineLead[]; redePublica?: boolean }) {
  if (leads.length === 0) {
    return (
      <p className="font-text text-sm text-base/60">
        Nenhum lead capturado ainda. Quando alguém preencher o wizard em{' '}
        <code className="font-mono text-xs">/vender</code>, aparece aqui
        pra qualificar e gerar oferta firme.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {leads.map((l) => (
        <LeadCard key={l.id} lead={l} redePublica={redePublica} />
      ))}
    </div>
  );
}

function LeadCard({ lead, redePublica }: { lead: PipelineLead; redePublica: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ofertaCorrente = lead.ofertas[0] ?? null;
  const cessao = ofertaCorrente?.cessao ?? null;
  const pagamento = cessao?.pagamento ?? null;
  const cota = cessao?.cota ?? null;
  const [laudoUrl, setLaudoUrl] = useState('');
  const [situacao, setSituacao] = useState('TITULAR_UNICO');
  const [atestado, setAtestado] = useState(false);
  const [anuenciaTipo, setAnuenciaTipo] = useState(redePublica ? 'CONFIRMADA' : 'DECLARADA_PENDENTE');
  const [anuenciaRef, setAnuenciaRef] = useState('');

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch('/api/admin/originacao', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-plina-admin': '1',
        },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        // Só a mensagem fixa de domínio + o code; sem corpo cru (pode ter detalhe de validação).
        const j = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
        throw new Error(
          typeof j.code === 'string' && typeof j.error === 'string'
            ? `${j.error} (${j.code})`
            : `Falha ao executar a ação (HTTP ${res.status}).`,
        );
      }
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-light-hairline">
      <header className="px-4 py-3 border-b border-light-hairline flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <p className="font-text text-sm font-semibold">{lead.nome}</p>
          <p className="font-mono text-xs text-base/60">{lead.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase bg-base text-lightBg px-2 py-1">
            {STATUS_LABEL[lead.status] ?? lead.status}
          </span>
          <span className="font-mono text-[10px] text-base/50">
            {new Date(lead.criadoEm).toLocaleDateString('pt-BR')}
          </span>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        {/* Stage 1: Sem oferta ainda */}
        {!ofertaCorrente && (
          <NovaOfertaForm leadId={lead.id} onSubmit={call} busy={busy} />
        )}

        {/* Stage 2: Tem oferta */}
        {ofertaCorrente && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center bg-document-grey/40 p-3 border border-light-hairline">
            <div className="text-xs font-text">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-1">
                Oferta v{ofertaCorrente.versao} · {ofertaCorrente.status}
              </p>
              <p className="font-mono">
                R$ {Number(ofertaCorrente.valorCarta.toString()).toLocaleString('pt-BR')}{' '}
                @{' '}
                {(Number(ofertaCorrente.desagioAquisicao.toString()) * 100).toFixed(0)}%{' '}
                → R${' '}
                {Number(ofertaCorrente.valorLiquidoVendedor.toString()).toLocaleString('pt-BR')}
              </p>
              <p className="text-base/60 mt-1">
                {ofertaCorrente.tipoBem} · {ofertaCorrente.administradora} ·
                validade{' '}
                {new Date(ofertaCorrente.validade).toLocaleString('pt-BR', {
                  hour12: false,
                })}
              </p>
            </div>
            {ofertaCorrente.status === 'ACEITA' && !cessao && (
              <button
                onClick={() => call('registrar-cessao', { ofertaId: ofertaCorrente.id })}
                disabled={busy}
                className="bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
              >
                Registrar cessão
              </button>
            )}
            {ofertaCorrente.status === 'ENVIADA' && (
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50">
                Aguardando aceite do vendedor
              </span>
            )}
          </div>
        )}

        {/* Stage 3: Tem cessão */}
        {cessao && (
          <div className="border-l-2 border-primary pl-4 py-2">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
              Cessão · {cessao.status}
            </p>
            {cessao.onChainTxHash && (
              <a
                href={explorerTx(cessao.onChainTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] underline text-primary-deep hover:text-primary"
              >
                {cessao.onChainTxHash.slice(0, 16)}… ↗
              </a>
            )}
            <a
              href={`/cessao/${cessao.id}/comprovante`}
              className="ml-3 font-details text-[10px] tracking-[0.2em] uppercase underline text-base/70 hover:text-primary-deep"
            >
              Ver comprovante
            </a>

            <ul className="mt-2 font-text text-xs text-base/80 space-y-0.5" aria-label="Estado da cessão">
              <li>Laudo: {cessao.laudoRegistrado ? 'registrado' : 'pendente'}</li>
              <li>
                Assinatura:{' '}
                {cessao.status === 'ASSINADA'
                  ? 'assinada'
                  : cessao.status === 'ENVIADA_DOCUSIGN'
                    ? 'aguardando assinatura'
                    : 'não enviada'}
              </li>
              <li>Titular do laudo: {cessao.titularSituacao ?? 'não confirmado'}</li>
              <li>Anuência da administradora: {ROTULO_ANUENCIA[cessao.anuenciaStatus ?? ''] ?? 'não registrada'}</li>
              <li>Pix ao cedente: {cessao.pixStatus ?? 'não iniciado'}</li>
              <li>Cota: {cota ? 'incorporada' : 'não incorporada'}</li>
            </ul>

            {cessao.status === 'PENDENTE' && !cessao.laudoRegistrado && (
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    URL do laudo (com #sha256 do documento)
                  </span>
                  <input
                    type="url"
                    value={laudoUrl}
                    onChange={(e) => setLaudoUrl(e.target.value)}
                    placeholder="https://…/laudo.pdf#sha256=…"
                    className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-mono text-xs"
                  />
                  <span className="mt-1 block font-text text-xs text-base/70">
                    O laudo precisa ter o item 7 (quitação): saldo devedor R$ 0,00, conforme documento da administradora (na
                    testnet, o documento de teste rotulado). Sem dado pessoal.
                  </span>
                </label>
                <button
                  onClick={() => call('registrar-laudo', { cessaoId: cessao.id, laudoUrl: laudoUrl.trim() })}
                  disabled={busy || !/^https?:\/\//.test(laudoUrl.trim())}
                  className={BTN}
                >
                  Registrar laudo
                </button>
              </div>
            )}

            {cessao.status === 'PENDENTE' && cessao.laudoRegistrado && (
              <div className="mt-2">
                <p className="font-text text-xs text-base/70 mb-2">Laudo registrado. Falta enviar à assinatura.</p>
                <button onClick={() => call('enviar-cessao', { cessaoId: cessao.id })} disabled={busy} className={BTN}>
                  Enviar para assinatura (DocuSign)
                </button>
              </div>
            )}

            {cessao.status === 'ENVIADA_DOCUSIGN' && (
              <div className="mt-2">
                <p className="font-text text-xs text-base/70 mb-2">Aguardando assinatura do cedente.</p>
                <button onClick={() => call('sincronizar-cessoes', { cessaoId: cessao.id })} disabled={busy} className={BTN}>
                  Sincronizar assinatura
                </button>
              </div>
            )}

            {cessao.status === 'ASSINADA' && !cessao.titularSituacao && !pagamento && (
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Titular confirmado no laudo
                  </span>
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
                <label className="flex items-start gap-2 font-text text-xs text-base/80">
                  <input
                    type="checkbox"
                    checked={atestado}
                    onChange={(e) => setAtestado(e.target.checked)}
                    className="mt-0.5 w-5 h-5 accent-primary-deep"
                  />
                  Atesto que o titular indicado no laudo é o titular do CPF do cadastro do cedente (na testnet, o cedente fictício do documento de teste).
                </label>
                <button
                  onClick={() => call('confirmar-titular-laudo', { cessaoId: cessao.id, situacao, atestado })}
                  disabled={busy || !atestado}
                  className={BTN}
                >
                  Confirmar titular do laudo
                </button>
              </div>
            )}

            {cessao.status === 'ASSINADA' && cessao.titularSituacao && cessao.titularSituacao !== 'TITULAR_UNICO' && (
              <p className="mt-2 font-text text-xs text-base/80">
                Situação do titular: {cessao.titularSituacao}. Fora do fluxo automático (tratamento manual pela equipe).
              </p>
            )}

            {cessao.laudoRegistrado && cessao.laudoHash && !cessao.anuenciaStatus && !cota && (
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Anuência da administradora
                  </span>
                  <select
                    value={anuenciaTipo}
                    onChange={(e) => setAnuenciaTipo(e.target.value)}
                    className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-text text-sm"
                  >
                    {!redePublica && <option value="DECLARADA_PENDENTE">Declarada, pendente (anuência simulada na testnet)</option>}
                    <option value="CONFIRMADA">Confirmada pela administradora</option>
                  </select>
                  <span className="mt-1 block font-text text-xs text-base/70">
                    Na demonstração, usar “Declarada, pendente”. “Confirmada pela administradora” só com documento dela, e exige
                    a referência.
                  </span>
                </label>
                <label className="block">
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    {anuenciaTipo === 'CONFIRMADA' ? 'Referência do documento da administradora' : 'Referência (opcional)'}
                  </span>
                  <input
                    type="text"
                    maxLength={200}
                    value={anuenciaRef}
                    onChange={(e) => setAnuenciaRef(e.target.value)}
                    className="mt-1 w-full min-h-[44px] bg-white border border-base/55 px-3 py-2 font-text text-sm"
                  />
                </label>
                <button
                  onClick={() =>
                    call('registrar-anuencia', {
                      hashValidacao: cessao.laudoHash,
                      status: anuenciaTipo,
                      ...(anuenciaRef.trim() ? { referencia: anuenciaRef.trim() } : {}),
                    })
                  }
                  disabled={busy || (anuenciaTipo === 'CONFIRMADA' && !anuenciaRef.trim())}
                  className={BTN}
                >
                  Registrar anuência
                </button>
              </div>
            )}

            {cessao.status === 'ASSINADA' &&
              cessao.titularSituacao === 'TITULAR_UNICO' &&
              cessao.pixStatus !== 'COMPROVADA' &&
              (!pagamento || pagamento.status !== 'EXECUTADO') && (
                <div className="mt-2">
                  {cessao.pixStatus === 'FALHOU' ? (
                    <>
                      <p className="font-text text-xs text-base/70 mb-2">
                        O Pix falhou e foi confirmado pelo PSP. Reabrir pagamento é uma ação auditada.
                      </p>
                      <button
                        onClick={() => call('reabrir-pagamento-cedente', { cessaoId: cessao.id })}
                        disabled={busy}
                        className={BTN}
                      >
                        Reabrir pagamento
                      </button>
                    </>
                  ) : (
                    <>
                      {cessao.pixStatus && (
                        <p className="font-text text-xs text-base/70 mb-2">
                          Pix em andamento ({cessao.pixStatus}). Repetir a ação só reconsulta o estado; não paga de novo.
                        </p>
                      )}
                      <button
                        onClick={() => call('pagar-cedente', { cessaoId: cessao.id })}
                        disabled={busy}
                        className={BTN}
                      >
                        {cessao.pixStatus ? 'Reconsultar pagamento' : redePublica ? 'Pagar cedente (Pix)' : 'Pagar cedente (Pix simulado, rede de testes)'}
                      </button>
                    </>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Stage 4: Tem pagamento */}
        {pagamento && pagamento.status === 'EXECUTADO' && (
          <div className="border-l-2 border-primary pl-4 py-2">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
              Pix · executado
            </p>
            {pagamento.onChainTxHash && (
              <a
                href={explorerTx(pagamento.onChainTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] underline text-primary-deep hover:text-primary"
              >
                {pagamento.onChainTxHash.slice(0, 16)}… ↗
              </a>
            )}

            {!cota && cessao && (
              <div className="mt-2">
                {!cessao.anuenciaStatus && (
                  <p className="font-text text-xs text-base/70 mb-2">Falta registrar a anuência da administradora.</p>
                )}
                <button
                  onClick={() => call('incorporar-cota', { cessaoId: cessao.id })}
                  disabled={busy || !cessao.anuenciaStatus}
                  className={BTN}
                >
                  Incorporar cota ao pool · emitir PLINA-RF
                </button>
              </div>
            )}
          </div>
        )}

        {/* Stage 5: Cota incorporada */}
        {cota && (
          <div className="border-l-2 border-primary pl-4 py-2 bg-primary/5">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
              ✓ Cota incorporada ao pool · {cota.id}
            </p>
          </div>
        )}

        {erro && (
          <p className="font-text text-sm text-red-700">{erro}</p>
        )}
      </div>
    </div>
  );
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit('gerar-oferta', {
          leadVendedorId: leadId,
          tipoBem: fd.get('tipoBem'),
          valorCarta: fd.get('valorCarta'),
          administradora: fd.get('administradora'),
          desagioAquisicao: fd.get('desagioAquisicao'),
          prazoRestanteMeses: fd.get('prazoRestanteMeses') || undefined,
          validadeHoras: 48,
        });
      }}
      className="bg-document-grey/40 p-3 border border-light-hairline grid grid-cols-2 md:grid-cols-6 gap-2 items-end"
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
          step="1000"
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
          step="0.001"
          min="0"
          max="1"
          required
          placeholder="0.20"
          className={inputCls + ' font-mono'}
        />
      </Field>
      <Field label="Prazo (m)">
        <input
          name="prazoRestanteMeses"
          type="number"
          min="0"
          placeholder="18"
          className={inputCls + ' font-mono'}
        />
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-3 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
      >
        Gerar oferta
      </button>
    </form>
  );
}

const inputCls =
  'w-full bg-white border border-light-hairline px-2 py-1.5 font-text text-xs focus:outline-none focus:ring-2 focus:ring-primary';

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
