'use client';

/**
 * Pipeline compradores no /admin. Mostra reservas ativas + leads sem
 * reserva. Form inline pra executar Caminho A (finaliza realização).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PipelineComprador {
  id: string;
  nome: string;
  email: string;
  tipo: string;
  intencaoBem: string | null;
  status: string;
  criadoEm: string | Date;
  reservas: Array<{
    id: string;
    status: string;
    expiraEm: string | Date;
    onChainTxHash: string | null;
    cota: {
      id: string;
      tipoBem: string;
      valorCarta: string | number | { toString(): string };
      desagioRevenda: string | number | { toString(): string } | null;
      status: string;
    };
  }>;
}

const STATUS_LEAD: Record<string, string> = {
  NOVO: 'Novo',
  QUALIFICADO: 'Qualificado',
  RESERVOU: 'Reservou',
  FECHOU: 'Caminho A fechado',
  PERDIDO: 'Perdido',
};

const STATUS_RESERVA: Record<string, string> = {
  ATIVA: 'Ativa',
  EXPIRADA: 'Expirada',
  CONFIRMADA: 'Confirmada · Caminho A',
  CANCELADA: 'Cancelada',
};

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export function CompradorPipeline({ leads }: { leads: PipelineComprador[] }) {
  if (leads.length === 0) {
    return (
      <p className="font-text text-sm text-base/60">
        Nenhum lead comprador capturado ainda. Quando alguém preencher{' '}
        <code className="font-mono text-xs">/comprar/lead</code> ou{' '}
        <code className="font-mono text-xs">/comprar/reservar</code>, aparece
        aqui.
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

function LeadCard({ lead }: { lead: PipelineComprador }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const reservaAtiva = lead.reservas.find((r) => r.status === 'ATIVA');
  const reservaConfirmada = lead.reservas.find((r) => r.status === 'CONFIRMADA');

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch('/api/admin/realizacao', {
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
          <p className="font-text text-sm font-semibold">
            {lead.nome}{' '}
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50 ml-1">
              {lead.tipo === 'PESSOA_JURIDICA' ? 'PJ' : 'PF'}
            </span>
          </p>
          <p className="font-mono text-xs text-base/60">{lead.email}</p>
          {lead.intencaoBem && (
            <p className="font-text text-xs text-base/60 mt-0.5 italic">
              &ldquo;{lead.intencaoBem}&rdquo;
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase bg-base text-lightBg px-2 py-1">
            {STATUS_LEAD[lead.status] ?? lead.status}
          </span>
        </div>
      </header>

      <div className="px-4 py-4 space-y-3">
        {lead.reservas.length === 0 && (
          <p className="font-text text-xs text-base/60">
            Sem reservas ainda. Aguarda contato comercial.
          </p>
        )}

        {lead.reservas.map((r) => {
          const valorRevenda = r.cota.desagioRevenda
            ? Math.floor(
                Number(r.cota.valorCarta.toString()) *
                  (1 - Number(r.cota.desagioRevenda.toString())),
              )
            : Number(r.cota.valorCarta.toString());
          return (
            <div
              key={r.id}
              className={`border border-light-hairline p-3 ${
                r.status === 'CONFIRMADA' ? 'bg-primary/5' : 'bg-document-grey/40'
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Reserva · {STATUS_RESERVA[r.status] ?? r.status}
                  </p>
                  <p className="font-mono text-xs mt-1">
                    Cota {r.cota.id.slice(0, 8)}… · {r.cota.tipoBem} ·{' '}
                    {BRL.format(valorRevenda)}
                  </p>
                  <p className="font-text text-xs text-base/60 mt-1">
                    Expira{' '}
                    {new Date(r.expiraEm).toLocaleString('pt-BR', {
                      hour12: false,
                    })}
                  </p>
                </div>
                {r.onChainTxHash && (
                  <a
                    href={explorerTx(r.onChainTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] underline text-primary-deep"
                  >
                    {r.onChainTxHash.slice(0, 10)}… ↗
                  </a>
                )}
              </div>

              {r.status === 'ATIVA' && (
                <ExecutarCaminhoAForm
                  reservaId={r.id}
                  valorRevendaSugerido={valorRevenda}
                  onSubmit={call}
                  busy={busy}
                />
              )}
              {r.status === 'ATIVA' && (
                <button
                  onClick={() => call('cancelar-reserva', { reservaId: r.id })}
                  disabled={busy}
                  className="mt-2 font-details text-[10px] tracking-[0.2em] uppercase underline text-base/60 hover:text-red-700 disabled:opacity-50"
                >
                  Cancelar reserva
                </button>
              )}
            </div>
          );
        })}

        {reservaConfirmada && !reservaAtiva && (
          <p className="font-text text-xs text-primary-deep">
            ✓ Caminho A executado. Cota saiu do pool. Spread capturado.
          </p>
        )}

        {erro && <p className="font-text text-sm text-red-700">{erro}</p>}
      </div>
    </div>
  );
}

function ExecutarCaminhoAForm({
  reservaId,
  valorRevendaSugerido,
  onSubmit,
  busy,
}: {
  reservaId: string;
  valorRevendaSugerido: number;
  onSubmit: (action: string, payload: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit('executar-caminho-a', {
          reservaId,
          valorRealizado: fd.get('valorRealizado'),
        });
      }}
      className="mt-3 flex flex-col md:flex-row md:items-end gap-2"
    >
      <label className="block">
        <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 block mb-1">
          Valor recebido
        </span>
        <input
          name="valorRealizado"
          type="number"
          step="100"
          min="1"
          defaultValue={valorRevendaSugerido}
          required
          className="bg-white border border-light-hairline px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary w-40"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
      >
        Executar Caminho A
      </button>
    </form>
  );
}
