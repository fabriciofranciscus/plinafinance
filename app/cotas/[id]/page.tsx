/**
 * /cotas/[id] — detalhe pra comprador-usuário.
 *
 * Não expõe administradora nem dados do vendedor original. Mostra:
 *   valor, deságio revenda, economia, local, prazo, status, CTA reservar.
 */

import Link from 'next/link';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const TIPO_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviços',
};

const TAXA_ANUAL_BANCO: Record<string, number> = {
  IMOVEL: 0.115,
  VEICULO: 0.27,
  EQUIPAMENTO: 0.22,
  SERVICO: 0.3,
};
const PRAZO_FIN_MESES: Record<string, number> = {
  IMOVEL: 240,
  VEICULO: 60,
  EQUIPAMENTO: 48,
  SERVICO: 36,
};

function pmt(valor: number, taxaAnual: number, meses: number): number {
  const i = taxaAnual / 12;
  return (valor * i) / (1 - Math.pow(1 + i, -meses));
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CotaDetailPage({ params }: PageProps) {
  const { id } = await params;
  const cota = await db.cota.findUnique({ where: { id } });

  if (!cota) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-title text-3xl font-semibold">Cota não encontrada</h1>
        <Link
          href="/cotas"
          className="mt-6 inline-block font-details text-[10px] tracking-[0.2em] uppercase underline"
        >
          ← Voltar para cotas
        </Link>
      </div>
    );
  }

  const disponivel = cota.status === 'DISPONIVEL' && cota.desagioRevenda;
  const valorCarta = Number(cota.valorCarta);
  const desagioRevenda = Number(cota.desagioRevenda ?? 0);
  const valorRevenda = Math.floor(valorCarta * (1 - desagioRevenda));
  const economia = valorCarta - valorRevenda;

  const taxa = TAXA_ANUAL_BANCO[cota.tipoBem] ?? 0.15;
  const prazo = PRAZO_FIN_MESES[cota.tipoBem] ?? 60;
  const parcela = pmt(valorCarta, taxa, prazo);
  const totalFinanciamento = parcela * prazo;
  const economiaVsFin = totalFinanciamento - valorRevenda;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
      <header className="mb-10 border-b border-light-hairline pb-8">
        <Link
          href="/cotas"
          className="font-details text-[10px] tracking-[0.2em] uppercase underline text-base/70"
        >
          ← Cotas disponíveis
        </Link>
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep mt-6">
          {TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem}
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-3">
          {BRL.format(valorCarta)} <span className="text-base/40 text-2xl md:text-3xl">de carta</span>
        </h1>
      </header>

      <section className="mb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
          <div className="bg-sheet-white p-6">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
              Você paga
            </p>
            <p className="font-title text-3xl md:text-4xl font-semibold mt-2 tracking-tight">
              {BRL.format(valorRevenda)}
            </p>
            <p className="font-mono text-xs text-base/60 mt-2">
              Deságio revenda {(desagioRevenda * 100).toFixed(1)}% sobre o
              valor de face.
            </p>
          </div>
          <div className="bg-base text-lightBg p-6">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
              Economia imediata
            </p>
            <p className="font-title text-3xl md:text-4xl font-semibold mt-2 tracking-tight">
              {BRL.format(economia)}
            </p>
            <p className="font-mono text-xs text-lightBg/70 mt-2">
              Ou {BRL.format(economiaVsFin)} se compararmos com financiamento
              de {prazo} parcelas a {(taxa * 100).toFixed(1)}% a.a. (
              {BRL.format(parcela)}/mês).
            </p>
          </div>
        </div>
      </section>

      <section className="mb-12 border-y border-light-hairline divide-y divide-light-hairline">
        <Row label="Tipo de bem" value={TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem} />
        <Row label="Valor da carta" value={BRL.format(valorCarta)} mono />
        <Row
          label="Deságio revenda"
          value={`${(desagioRevenda * 100).toFixed(2)}%`}
          mono
        />
        <Row label="Localização aproximada" value={cota.localizacaoAprox ?? '—'} />
        <Row
          label="Prazo restante"
          value={cota.prazoRestanteMeses ? `${cota.prazoRestanteMeses} meses` : '—'}
          mono
        />
        <Row label="Status" value={cota.status} mono />
      </section>

      {disponivel ? (
        <section className="mb-12">
          <Link
            href={`/comprar/reservar?cotaId=${cota.id}`}
            className="inline-block bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-8 py-4 hover:bg-primary-deep transition-colors"
          >
            Reservar por 72h →
          </Link>
          <p className="font-text text-xs text-base/60 mt-4 max-w-prose leading-relaxed">
            A reserva trava a cota por 72 horas pra você qualificar capital +
            preparar transferência. Após qualificação, Plina coordena a
            transferência de titularidade na administradora. Contrato com
            hash on-chain após assinatura.
          </p>
        </section>
      ) : (
        <section className="mb-12">
          <p className="font-text text-base/70">
            Esta cota não está disponível pra reserva no momento (status{' '}
            <span className="font-mono text-sm">{cota.status}</span>).
          </p>
        </section>
      )}

      <section>
        <h2 className="font-title text-xl font-semibold tracking-tight mb-4">
          Detalhes que você só vê depois de qualificar
        </h2>
        <ul className="space-y-2 font-text text-sm text-base/75 max-w-prose">
          <li>· Administradora exata da cota.</li>
          <li>· Número de grupo e cota interno.</li>
          <li>· Contatos de suporte à transferência.</li>
          <li>· Documentação completa (extrato + comprovante de contemplação).</li>
        </ul>
        <p className="font-text text-xs text-base/55 mt-4 leading-relaxed max-w-prose">
          Pré-revelar essas informações expõe o vendedor original sem
          contrato firmado. Política de privacidade alinhada à LGPD e ao
          princípio do whitepaper §9: PII off-chain, on-chain só hash.
        </p>
      </section>
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
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-2 md:gap-6 py-3">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 pt-1">
        {label}
      </span>
      <span className={mono ? 'font-mono text-xs' : 'font-text text-sm'}>
        {value}
      </span>
    </div>
  );
}
