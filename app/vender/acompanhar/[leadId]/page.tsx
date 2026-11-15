/**
 * /vender/acompanhar/[leadId] — acompanhamento do cedente (PRD §M1 F-M1-5; item 19, Argus/Bento).
 *
 * Server Component PÚBLICO que mostra só o que o link sozinho pode revelar: a ETAPA e o status
 * (`acompanharPublico`, leitura com `select: { status }`: nome, valores, hashes e ids de oferta/cessão nem saem do
 * banco). O detalhe do dono (nome, proposta, transações, aceite) vem de GET /api/vender/acompanhar/<id> com o Bearer
 * do Privy, buscado pelo componente cliente `AcompanharPrivado`: quem tem o link mas não é o dono não vê dado pessoal.
 *
 * `referrer: no-referrer`: o id do lead está na URL e não deve vazar para links externos (explorer, e-mail do parceiro).
 */

import type { Metadata } from 'next';
import { acompanharPublico } from '@/lib/services/acompanhar';
import { ETAPAS_VENDER } from '@/lib/vender/etapas';
import WizardHeader from '@/components/vender/WizardHeader';
import AcompanharPrivado from '@/components/vender/AcompanharPrivado';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ leadId: string }>;
}

export default async function AcompanharPage({ params }: PageProps) {
  const { leadId } = await params;
  const publico = await acompanharPublico(leadId);

  if (!publico) {
    return (
      <div className="min-h-screen bg-sheet-white text-base">
        <WizardHeader active="cotistas" />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">Solicitação não encontrada</p>
          <h1 className="font-title text-3xl font-semibold mt-3">Link inválido</h1>
          <p className="font-text text-base/70 mt-4">O identificador informado não corresponde a nenhuma solicitação. Confira o link recebido.</p>
        </div>
      </div>
    );
  }

  const etapa = publico.encerrado ? null : ETAPAS_VENDER[Math.min(Math.max(publico.etapaAtual, 0), ETAPAS_VENDER.length - 1)];

  return (
    <div className="min-h-screen bg-sheet-white text-base">
      <WizardHeader active="cotistas" />
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <header className="border-b border-light-hairline pb-8 mb-10">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">Acompanhamento · solicitação de venda</p>
          <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">
            {publico.encerrado ? 'Solicitação encerrada' : 'Sua solicitação em andamento'}
          </h1>
          {etapa && (
            <p data-testid="etapa-publica" className="font-text text-sm text-base/70 mt-3">
              Etapa atual: {etapa}
            </p>
          )}
        </header>

        <AcompanharPrivado leadId={leadId} />
      </div>
    </div>
  );
}
