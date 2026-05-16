/**
 * /cotas — listagem pública filtrada pra comprador-usuário.
 *
 * Server Component. Mostra cotas DISPONIVEL com desagioRevenda definido.
 * Administradora NÃO exposta (whitepaper: só revelada pós-qualificação).
 */

import Link from 'next/link';
import { db } from '@/lib/db';
import { listarCotasParaCompra } from '@/lib/services/realizacao';

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

export default async function CotasPage() {
  const cotas = await listarCotasParaCompra();
  const total = await db.cota.count({ where: { status: 'DISPONIVEL' } });

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <header className="mb-12 border-b border-light-hairline pb-8">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Cotas disponíveis · {cotas.length} ofertas
        </p>
        <h1 className="font-title text-4xl md:text-5xl font-semibold tracking-tight mt-3">
          Compre direto. Sem CET.
        </h1>
        <p className="font-text text-base/80 mt-4 max-w-2xl leading-relaxed">
          Cartas de crédito de consórcio contempladas, com deságio sobre o
          valor de face. Reserve por 72h enquanto qualifica a transferência.
        </p>
        <div className="mt-6 flex gap-3 text-xs">
          <Link
            href="/comprar"
            className="font-details tracking-[0.2em] uppercase underline text-base/70 hover:text-primary-deep"
          >
            ← Calculadora comparativa
          </Link>
          <span className="text-base/30">·</span>
          <Link
            href="/comprar/lead"
            className="font-details tracking-[0.2em] uppercase underline text-base/70 hover:text-primary-deep"
          >
            Qualificar-me
          </Link>
        </div>
      </header>

      {cotas.length === 0 ? (
        <p className="font-text text-base/70">
          Nenhuma cota com deságio de revenda definido no momento. O pool
          tem {total} cotas ativas. Volte em breve ou cadastre alerta na
          página de qualificação.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
          {cotas.map((c) => (
            <CotaCard
              key={c.id}
              id={c.id}
              tipoBem={c.tipoBem}
              valorCarta={Number(c.valorCarta)}
              desagioRevenda={Number(c.desagioRevenda)}
              localizacaoAprox={c.localizacaoAprox}
              prazoRestanteMeses={c.prazoRestanteMeses}
            />
          ))}
        </div>
      )}

      <p className="mt-8 font-text text-xs text-base/60 max-w-2xl">
        Identificadores administrativos (número de grupo, administradora,
        titular original) são revelados apenas após qualificação. On-chain
        circula apenas hash da cessão, NAV e endereços públicos.
      </p>
    </div>
  );
}

function CotaCard({
  id,
  tipoBem,
  valorCarta,
  desagioRevenda,
  localizacaoAprox,
  prazoRestanteMeses,
}: {
  id: string;
  tipoBem: string;
  valorCarta: number;
  desagioRevenda: number;
  localizacaoAprox: string | null;
  prazoRestanteMeses: number | null;
}) {
  const valorRevenda = Math.floor(valorCarta * (1 - desagioRevenda));
  const economia = valorCarta - valorRevenda;

  return (
    <Link
      href={`/cotas/${id}`}
      className="group bg-sheet-white p-6 hover:bg-base hover:text-lightBg transition-colors flex flex-col"
    >
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 group-hover:text-lightBg/60">
        {TIPO_LABEL[tipoBem] ?? tipoBem}
      </p>
      <p className="font-title text-2xl md:text-3xl font-semibold mt-2 tracking-tight">
        {BRL.format(valorCarta)}
      </p>
      <p className="font-mono text-xs text-base/60 group-hover:text-lightBg/60 mt-1">
        Você paga {BRL.format(valorRevenda)} · poupa{' '}
        <span className="text-primary-deep group-hover:text-primary">
          {BRL.format(economia)}
        </span>
      </p>

      <div className="mt-4 pt-4 border-t border-base/15 group-hover:border-lightBg/20 grid grid-cols-2 gap-2 text-xs">
        {localizacaoAprox && (
          <div>
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50 group-hover:text-lightBg/50">
              Local
            </p>
            <p className="font-text mt-0.5">{localizacaoAprox}</p>
          </div>
        )}
        {prazoRestanteMeses && (
          <div>
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50 group-hover:text-lightBg/50">
              Prazo
            </p>
            <p className="font-mono mt-0.5">{prazoRestanteMeses}m</p>
          </div>
        )}
      </div>

      <p className="mt-auto pt-6 font-details text-[10px] tracking-[0.2em] uppercase underline decoration-base/30 group-hover:decoration-primary">
        Ver detalhes →
      </p>
    </Link>
  );
}
