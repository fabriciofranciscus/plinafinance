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
import { contextoDoStatus, etapaDoStatus, isEncerrado } from '@/lib/vender/etapas';
import WizardHeader from '@/components/vender/WizardHeader';
import StepperVender from '@/components/vender/StepperVender';

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
      // Prova on-chain do consentimento registrada na captura do lead —
      // exibida na etapa de validação jurídica (hash do documento na Stellar).
      eventos: {
        where: { acao: 'LEAD_VENDEDOR_CAPTURADO' },
        orderBy: { criadoEm: 'desc' },
        take: 1,
      },
    },
  });

  if (!lead) {
    return (
      <div className="min-h-screen bg-sheet-white text-base">
        <WizardHeader active="cotistas" />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Solicitação não encontrada
          </p>
          <h1 className="font-title text-3xl font-semibold mt-3">
            Link inválido
          </h1>
          <p className="font-text text-base/70 mt-4">
            O identificador informado não corresponde a nenhuma solicitação.
            Confira o link recebido.
          </p>
        </div>
      </div>
    );
  }

  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  const pagamento = cessao?.pagamento ?? null;
  const cota = cessao?.cota ?? null;
  const etapaAtual = etapaDoStatus(lead.status);
  const encerrado = isEncerrado(lead.status);
  const contexto = contextoDoStatus(lead.status);
  // Etapa 2 = "Validação jurídica" (ver ETAPAS_VENDER / etapaDoStatus).
  const naValidacao = etapaAtual === 2;
  const consentTxHash = lead.eventos[0]?.stellarTxHash ?? null;

  return (
    <div className="min-h-screen bg-sheet-white text-base">
      <WizardHeader active="cotistas" />
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
        <>
          <StepperVender current={etapaAtual} />

          <section className="mt-10 border border-light-hairline bg-white p-6 md:p-7">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
              Etapa atual
            </p>
            <h2 className="font-title text-xl font-semibold tracking-tight mt-2">
              {contexto.titulo}
            </h2>
            <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">
              {contexto.descricao}
            </p>

            {naValidacao && (
              <DetalheValidacao consentTxHash={consentTxHash} />
            )}
          </section>
        </>
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
    </div>
  );
}

/**
 * Detalhe da etapa "Validação jurídica" (espelha o mockup): duas camadas de
 * anuência — integração B2B com a administradora (caminho preferencial) e
 * cartório digital com e-CPF (fallback) — mais o hash do consentimento já
 * registrado on-chain na captura do lead.
 */
function DetalheValidacao({ consentTxHash }: { consentTxHash: string | null }) {
  return (
    <div className="mt-6 border-t border-light-hairline pt-6">
      <p className="font-text text-sm text-base/70">
        Duas camadas — caminho preferencial e fallback.
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-4 border border-primary/30 bg-primary/5 p-4">
          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-base shrink-0">
            ✓
          </span>
          <div>
            <p className="font-text text-sm font-semibold text-base">
              Integração B2B com administradora via API
            </p>
            <p className="font-mono text-xs text-base/60 mt-0.5">
              Caminho preferencial · SLA contratual
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 border border-light-hairline p-4">
          <span className="mt-0.5 h-5 w-5 rounded-full border border-base/30 shrink-0" />
          <div>
            <p className="font-text text-sm font-semibold text-base">
              Cartório digital com e-CPF
            </p>
            <p className="font-mono text-xs text-base/60 mt-0.5">
              Fallback · Taxa de anuência 1–3% embutida no deságio
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border border-primary/30 bg-document-grey/40 p-4">
        <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
        <span className="flex-1 font-text text-sm text-base/70 min-w-[12rem]">
          Hash do consentimento registrado on-chain na Stellar
        </span>
        {consentTxHash ? (
          <a
            href={txExplorerUrl(consentTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs underline text-primary-deep hover:text-primary"
          >
            {consentTxHash.slice(0, 8)}… → Stellar Expert
          </a>
        ) : (
          <span className="font-mono text-xs text-base/50">pendente</span>
        )}
      </div>
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
