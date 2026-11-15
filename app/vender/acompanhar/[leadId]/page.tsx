/**
 * /vender/acompanhar/[leadId] — acompanhamento do cedente (PRD §M1 F-M1-5; item 19, Argus/Bento/Consuelo).
 *
 * Server Component PÚBLICO e IDÊNTICO para qualquer id: não lê o banco nem diz se a solicitação existe, em que etapa
 * está ou se foi encerrada (a resposta de um id inexistente e a de um id real são a mesma página). Tudo isso (etapa,
 * nome, proposta, transações, aceite) vem de GET /api/vender/acompanhar/<id> com o Bearer do Privy, buscado pelo
 * componente cliente `AcompanharPrivado`: quem tem o link mas não é o dono vê só "Entre para ver os detalhes" ou
 * "Solicitação não encontrada neste login".
 *
 * `referrer: no-referrer`: o id do lead está na URL e não deve vazar para links externos (explorer, e-mail do parceiro).
 */

import type { Metadata } from 'next';
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

  return (
    <div className="min-h-screen bg-sheet-white text-base">
      <WizardHeader active="cotistas" />
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <header className="border-b border-light-hairline pb-8 mb-10">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">Acompanhamento · solicitação de venda</p>
          <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">Acompanhe sua solicitação</h1>
        </header>

        <AcompanharPrivado leadId={leadId} />
      </div>
    </div>
  );
}
