/**
 * /vender/acompanhar/[leadId] — acompanhamento do cedente (PRD §M1 F-M1-5).
 *
 * Server Component, sem auth: o `leadId` (cuid não-adivinhável) é o token de
 * acesso — mesmo padrão de `/cessao/[id]/comprovante`. Mostra um stepper das
 * etapas (Cadastro · Validação · Proposta · Cessão · Pix · Concluído) dirigido
 * pelo `LeadVendedor.status`, + resumo da oferta e links on-chain/comprovante.
 *
 * Privacidade: exibe só o que o próprio cedente já possui (status, valores da
 * oferta, hashes/links públicos) — nunca reexpõe CPF.
 */

import { db } from '@/lib/db';
import { txExplorerUrl } from '@/lib/stellar/config';
import { ETAPAS_VENDER, etapaDoStatus, isEncerrado } from '@/lib/vender/etapas';

export const dynamic = 'force-dynamic';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

interface PageProps {
  params: Promise<{ leadId: string }>;
}

export default async function AcompanharPage({ params }: PageProps) {
  const { leadId } = await params;

  const lead = await db.leadVendedor.findUnique({
    where: { id: leadId },
    include: {
      ofertas: {
        orderBy: { criadaEm: 'desc' },
        take: 1,
        include: {
          cessao: { include: { pagamento: true, cota: true } },
        },
      },
    },
  });

  if (!lead) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Solicitação não encontrada
        </p>
        <h1 className="font-title text-3xl font-semibold mt-3">Link inválido</h1>
        <p className="font-text text-base/70 mt-4">
          O identificador informado não corresponde a nenhuma solicitação.
          Confira o link recebido.
        </p>
      </div>
    );
  }

  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  const pagamento = cessao?.pagamento ?? null;
  const cota = cessao?.cota ?? null;
  const etapaAtual = etapaDoStatus(lead.status);
  const encerrado = isEncerrado(lead.status);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="border-b border-light-hairline pb-8 mb-10">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
          Acompanhamento · solicitação de venda
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">
          {encerrado ? 'Solicitação encerrada' : 'Sua solicitação em andamento'}
        </h1>
        <p className="font-mono text-xs text-base/60 mt-3">id: {lead.id}</p>
      </header>

      {encerrado ? (
        <p className="font-text text-base/80 leading-relaxed">
          Esta solicitação foi encerrada. Se acha que houve engano, fale com a
          equipe Plina respondendo o último email recebido.
        </p>
      ) : (
        <ol className="space-y-px bg-base/10 border-y border-light-hairline">
          {ETAPAS_VENDER.map((etapa, idx) => {
            const isDone = idx < etapaAtual;
            const isCurrent = idx === etapaAtual;
            return (
              <li
                key={etapa}
                className="relative bg-white px-5 py-4 flex items-center gap-5"
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-0 h-full w-[2px] ${
                    isDone || isCurrent ? 'bg-primary' : 'bg-base/15'
                  }`}
                />
                <span
                  className={`font-mono text-xs ${
                    isDone
                      ? 'text-primary-deep'
                      : isCurrent
                        ? 'text-base'
                        : 'text-base/35'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span
                  className={`font-text text-sm flex-1 ${
                    isCurrent
                      ? 'text-base font-semibold'
                      : isDone
                        ? 'text-base/70'
                        : 'text-base/40'
                  }`}
                >
                  {etapa}
                </span>
                {isDone && (
                  <span
                    className="font-mono text-[10px] text-primary-deep"
                    aria-label="concluído"
                  >
                    ✓
                  </span>
                )}
                {isCurrent && (
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
                    agora
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {oferta && (
        <section className="mt-12 border border-light-hairline">
          <Row label="Status" value={lead.status} mono />
          <Row
            label="Valor líquido ofertado"
            value={BRL.format(Number(oferta.valorLiquidoVendedor))}
            mono
          />
          <Row
            label="Deságio aplicado"
            value={`${(Number(oferta.desagioAquisicao) * 100).toFixed(2)}%`}
            mono
          />
          <Row label="Tipo de bem" value={oferta.tipoBem} />
          <Row label="Administradora" value={oferta.administradora} />
          <Row
            label="Validade da oferta"
            value={new Date(oferta.validade).toLocaleString('pt-BR', {
              hour12: false,
            })}
            mono
          />
        </section>
      )}

      {cessao && (
        <section className="mt-8 border border-light-hairline">
          {cessao.onChainTxHash && (
            <Row
              label="Cessão on-chain"
              value={
                <a
                  href={txExplorerUrl(cessao.onChainTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] underline text-primary-deep hover:text-primary break-all"
                >
                  {cessao.onChainTxHash.slice(0, 12)}…
                </a>
              }
            />
          )}
          {pagamento?.onChainTxHash && (
            <Row
              label="Pix on-chain"
              value={
                <a
                  href={txExplorerUrl(pagamento.onChainTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] underline text-primary-deep hover:text-primary break-all"
                >
                  {pagamento.onChainTxHash.slice(0, 12)}…
                </a>
              }
            />
          )}
          <Row
            label="Comprovante"
            value={
              <a
                href={`/cessao/${cessao.id}/comprovante`}
                className="font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
              >
                Ver comprovante →
              </a>
            }
          />
        </section>
      )}

      {cota && (
        <p className="font-text text-sm text-base/70 mt-8 leading-relaxed">
          Sua cota foi incorporada ao pool tokenizado público. Composição em{' '}
          <a href="/pool" className="underline">
            /pool
          </a>
          .
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2 md:gap-6 py-3 px-4 border-b border-light-hairline last:border-b-0">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 pt-0.5">
        {label}
      </span>
      <span className={mono ? 'font-mono text-xs' : 'font-text text-sm'}>
        {value}
      </span>
    </div>
  );
}
