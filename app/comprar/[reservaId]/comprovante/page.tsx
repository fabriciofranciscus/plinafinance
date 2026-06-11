/**
 * /comprar/[reservaId]/comprovante — comprovante público auditável do comprador.
 *
 * Análogo ao /cessao/[id]/comprovante (vendedor), mas ancorado na Reserva — o
 * comprador não tem Oferta/Cessao. Server Component, sem auth (a reservaId é o
 * "token" de acesso). Mostra hashes da cessão do comprador, prova on-chain da
 * reserva e da realização, e a trilha de audit da cota. NÃO expõe PII.
 */

import { db } from '@/lib/db';
import { txExplorerUrl } from '@/lib/stellar/config';

export const dynamic = 'force-dynamic';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

interface PageProps {
  params: Promise<{ reservaId: string }>;
}

export default async function ComprovanteCompradorPage({ params }: PageProps) {
  const { reservaId } = await params;

  const reserva = await db.reserva.findUnique({
    where: { id: reservaId },
    include: {
      cota: { include: { realizacao: true } },
      cessaoComprador: true,
    },
  });

  if (!reserva) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Reserva não encontrada
        </p>
        <h1 className="font-title text-3xl font-semibold mt-3">Comprovante inválido</h1>
        <p className="font-text text-base/70 mt-4">
          A id informada não corresponde a nenhuma reserva registrada. Confira o
          link recebido.
        </p>
      </div>
    );
  }

  const events = await db.eventoAudit.findMany({
    where: { cotaId: reserva.cotaId },
    orderBy: { criadoEm: 'asc' },
  });

  const cessao = reserva.cessaoComprador;
  const realizacao = reserva.cota.realizacao;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="border-b border-light-hairline pb-8 mb-10">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
          Comprovante público · prova on-chain
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">
          {realizacao ? 'Aquisição concluída' : 'Reserva registrada'}
        </h1>
        <p className="font-mono text-xs text-base/60 mt-3">reserva: {reserva.id}</p>
      </header>

      <section className="mb-12 border border-light-hairline">
        <Row label="Status da reserva" value={reserva.status} mono />
        <Row label="Tipo de bem" value={reserva.cota.tipoBem} />
        <Row label="Valor de face" value={BRL.format(Number(reserva.cota.valorCarta))} mono />
        {realizacao && (
          <>
            <Row label="Valor pago" value={BRL.format(Number(realizacao.valorRealizado))} mono />
            <Row
              label="Economia"
              value={BRL.format(
                Number(reserva.cota.valorCarta) - Number(realizacao.valorRealizado),
              )}
              mono
            />
          </>
        )}
        <Row label="Status da cota" value={reserva.cota.status} mono />
        {cessao && (
          <Row
            label="Envelope (e-CPF/DocuSign)"
            value={cessao.docusignEnvelopeId ?? '—'}
            mono
          />
        )}
      </section>

      <section className="mb-12">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-4">
          Hashes auditáveis
        </p>
        <div className="border border-light-hairline divide-y divide-light-hairline">
          {cessao && (
            <HashRow
              label="SHA-256 do documento de cessão"
              value={cessao.hashDocumento}
              hint="Compute o SHA-256 do contrato de cessão. Deve bater com este valor."
            />
          )}
          {cessao?.onChainTxHash && (
            <HashRow
              label="Tx Stellar da cessão (Memo.hash)"
              value={cessao.onChainTxHash}
              hint="Memo da transação contém o SHA-256 acima."
              link={txExplorerUrl(cessao.onChainTxHash)}
            />
          )}
          <HashRow
            label="Tx Stellar da reserva"
            value={reserva.onChainTxHash}
            link={reserva.onChainTxHash ? txExplorerUrl(reserva.onChainTxHash) : null}
          />
          {realizacao?.onChainTxHash && (
            <HashRow
              label="Tx Stellar da realização"
              value={realizacao.onChainTxHash}
              hint="Transferência de titularidade e captura de spread."
              link={txExplorerUrl(realizacao.onChainTxHash)}
            />
          )}
        </div>
      </section>

      <section className="mb-12">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-4">
          Trilha auditável
        </p>
        <ol className="border-y border-light-hairline">
          {events.map((e) => (
            <li
              key={e.id}
              className="border-b border-light-hairline last:border-b-0 py-4 grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-2 md:gap-4 px-4"
            >
              <span className="font-mono text-[11px] text-base/60">
                {new Date(e.criadoEm).toLocaleString('pt-BR', { hour12: false })}
              </span>
              <span className="font-details text-[10px] tracking-[0.2em] uppercase">
                {e.acao}
              </span>
              {e.stellarTxHash ? (
                <a
                  href={txExplorerUrl(e.stellarTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] underline text-primary-deep break-all md:text-right"
                >
                  {e.stellarTxHash.slice(0, 10)}…
                </a>
              ) : (
                <span className="text-base/40">—</span>
              )}
            </li>
          ))}
        </ol>
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
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-2 md:gap-6 py-3 px-4 border-b border-light-hairline last:border-b-0">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 pt-0.5">
        {label}
      </span>
      <span className={mono ? 'font-mono text-xs' : 'font-text text-sm'}>{value}</span>
    </div>
  );
}

function HashRow({
  label,
  value,
  hint,
  link,
}: {
  label: string;
  value?: string | null;
  hint?: string;
  link?: string | null;
}) {
  return (
    <div className="p-4">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      {value ? (
        link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block font-mono text-xs mt-2 break-all underline text-primary-deep hover:text-primary"
          >
            {value}
          </a>
        ) : (
          <p className="font-mono text-xs mt-2 break-all">{value}</p>
        )
      ) : (
        <p className="font-text text-sm text-base/40 mt-2">—</p>
      )}
      {hint && (
        <p className="font-text text-xs text-base/60 mt-2 max-w-prose leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
