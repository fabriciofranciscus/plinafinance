'use client';

/**
 * Pipeline kanban dos vendedores no /admin. Cada lead mostra estágio
 * atual + botão pra próxima ação (gerar oferta → registrar cessão →
 * executar pix → incorporar cota).
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

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function VendedorPipeline({ leads }: { leads: PipelineLead[] }) {
  if (leads.length === 0) {
    return (
      <p className="font-text text-sm text-base/60">
        Nenhum lead capturado ainda. Quando alguém preencher{' '}
        <code className="font-mono text-xs">/vender/lead</code>, aparece aqui
        pra qualificar e gerar oferta firme.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {leads.map((l) => (
        <LeadCard key={l.id} lead={l} />
      ))}
    </div>
  );
}

function LeadCard({ lead }: { lead: PipelineLead }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ofertaCorrente = lead.ofertas[0] ?? null;
  const cessao = ofertaCorrente?.cessao ?? null;
  const pagamento = cessao?.pagamento ?? null;
  const cota = cessao?.cota ?? null;

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch('/api/admin/originacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
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

            {!pagamento || pagamento.status !== 'EXECUTADO' ? (
              <div className="mt-2">
                <button
                  onClick={() => call('executar-pix-simulado', { cessaoId: cessao.id })}
                  disabled={busy}
                  className="bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
                >
                  Executar Pix simulado
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Stage 4: Tem pagamento */}
        {pagamento && pagamento.status === 'EXECUTADO' && (
          <div className="border-l-2 border-primary pl-4 py-2">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
              Pix simulado · executado
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
                <button
                  onClick={() => call('incorporar-cota', { cessaoId: cessao.id })}
                  disabled={busy}
                  className="bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
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
