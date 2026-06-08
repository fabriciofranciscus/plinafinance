/**
 * /vender/acompanhar/[leadId] — acompanhamento do cedente (PRD §M1 F-M1-5).
 *
 * Server Component, sem auth: o `leadId` (cuid não-adivinhável) é o token de
 * acesso — mesmo padrão de `/cessao/[id]/comprovante`. Busca o lead, serializa
 * (sem Decimal/Date/SDK) e entrega ao `AcompanharView` (client), que cuida da
 * navegação de preview e da ação real de aceitar a oferta.
 *
 * Privacidade: expõe só o que o próprio cedente já possui (status, valores da
 * oferta, hashes/links públicos, nome do cedente) — nunca reexpõe CPF.
 */

import { db } from '@/lib/db';
import { txExplorerUrl } from '@/lib/stellar/config';
import {
  contextoDoStatus,
  etapaDoStatus,
  isEncerrado,
} from '@/lib/vender/etapas';
import WizardHeader from '@/components/vender/WizardHeader';
import AcompanharView, {
  type AcompanharData,
} from '@/components/vender/AcompanharView';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ leadId: string }>;
}

function txLink(hash: string | null | undefined) {
  if (!hash) return null;
  return { hashShort: hash.slice(0, 8), url: txExplorerUrl(hash) };
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

  const data: AcompanharData = {
    leadId: lead.id,
    cedenteNome: lead.nome,
    status: lead.status,
    etapaAtual: etapaDoStatus(lead.status),
    contextoDescricao: contextoDoStatus(lead.status).descricao,
    ofertaId: oferta?.id ?? null,
    oferta: oferta
      ? {
          valorCarta: Number(oferta.valorCarta),
          desagioPct: (Number(oferta.desagioAquisicao) * 100).toFixed(1),
          valorLiquido: Number(oferta.valorLiquidoVendedor),
          prazoRestanteMeses: oferta.prazoRestanteMeses,
          validade: new Date(oferta.validade).toLocaleString('pt-BR', {
            hour12: false,
          }),
        }
      : null,
    cessaoId: cessao?.id ?? null,
    consentTx: txLink(lead.eventos[0]?.stellarTxHash),
    cessaoTx: txLink(cessao?.onChainTxHash),
    pixTx: txLink(pagamento?.onChainTxHash),
    temCota: !!cessao?.cota,
  };

  const encerrado = isEncerrado(lead.status);

  return (
    <div className="min-h-screen bg-sheet-white text-base">
      <WizardHeader active="cotistas" />
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <header className="border-b border-light-hairline pb-8 mb-10">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
            Acompanhamento · solicitação de venda
          </p>
          <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">
            {encerrado
              ? 'Solicitação encerrada'
              : 'Sua solicitação em andamento'}
          </h1>
          <p className="font-mono text-xs text-base/60 mt-3">id: {lead.id}</p>
        </header>

        {encerrado ? (
          <p className="font-text text-base/80 leading-relaxed">
            Esta solicitação foi encerrada. Se acha que houve engano, fale com a
            equipe Plina respondendo o último email recebido.
          </p>
        ) : (
          <AcompanharView data={data} />
        )}
      </div>
    </div>
  );
}
