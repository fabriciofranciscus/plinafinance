/**
 * /cessao/[id]/comprovante — comprovante público auditável.
 *
 * Vendedor recebe esse link após cessão assinada. Server Component, sem
 * auth (a id da cessão é o "token" de acesso — quem tem o link tem o
 * comprovante). Mostra:
 *
 *   - Hash do documento (SHA-256)
 *   - TX hash Stellar com Memo.hash referente
 *   - Status do pagamento (Pix simulado, ou real em mainnet)
 *   - Cota incorporada (quando aplicável)
 *
 * Por design, NÃO expõe dados pessoais do vendedor — só hashes e IDs.
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
  params: Promise<{ id: string }>;
}

export default async function ComprovantePage({ params }: PageProps) {
  const { id } = await params;

  const cessao = await db.cessao.findUnique({
    where: { id },
    include: {
      oferta: true,
      pagamento: true,
      cota: true,
    },
  });

  if (!cessao) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Cessão não encontrada
        </p>
        <h1 className="font-title text-3xl font-semibold mt-3">
          Comprovante inválido
        </h1>
        <p className="font-text text-base/70 mt-4">
          A id informada não corresponde a nenhuma cessão registrada. Confira
          o link recebido.
        </p>
      </div>
    );
  }

  const events = await db.eventoAudit.findMany({
    where: { cessaoId: cessao.id },
    orderBy: { criadoEm: 'asc' },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="border-b border-light-hairline pb-8 mb-10">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
          Comprovante público · prova on-chain
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-3">
          Cessão registrada
        </h1>
        <p className="font-mono text-xs text-base/60 mt-3">id: {cessao.id}</p>
      </header>

      <section className="mb-12 border border-light-hairline">
        <Row label="Status" value={cessao.status} mono />
        <Row
          label="Valor líquido cedido"
          value={BRL.format(Number(cessao.oferta.valorLiquidoVendedor))}
          mono
        />
        <Row
          label="Deságio aplicado"
          value={`${(Number(cessao.oferta.desagioAquisicao) * 100).toFixed(2)}%`}
          mono
        />
        <Row label="Tipo de bem" value={cessao.oferta.tipoBem} />
        <Row label="Administradora" value={cessao.oferta.administradora} />
        <Row
          label="Assinada em"
          value={
            cessao.assinadaEm
              ? new Date(cessao.assinadaEm).toLocaleString('pt-BR', {
                  hour12: false,
                })
              : '—'
          }
          mono
        />
        <Row
          label="Envelope DocuSign"
          value={cessao.docusignEnvelopeId ?? '—'}
          mono
        />
      </section>

      <section className="mb-12">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-4">
          Hashes auditáveis
        </p>
        <div className="border border-light-hairline divide-y divide-light-hairline">
          <HashRow
            label="SHA-256 do documento"
            value={cessao.hashDocumento}
            hint="Compute o SHA-256 do PDF que você assinou. Deve bater com este valor."
          />
          <HashRow
            label="Tx Stellar (Memo.hash)"
            value={cessao.onChainTxHash}
            hint="Memo da transação contém o SHA-256 acima. Verifique no Stellar Expert."
            link={cessao.onChainTxHash ? txExplorerUrl(cessao.onChainTxHash) : null}
          />
        </div>
      </section>

      {cessao.pagamento && (
        <section className="mb-12">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-4">
            Pagamento
          </p>
          <div className="border border-light-hairline">
            <Row label="Método" value={cessao.pagamento.metodo} mono />
            <Row
              label="Valor"
              value={BRL.format(Number(cessao.pagamento.valor))}
              mono
            />
            <Row label="Status" value={cessao.pagamento.status} mono />
            <Row
              label="Executado em"
              value={
                cessao.pagamento.executadoEm
                  ? new Date(cessao.pagamento.executadoEm).toLocaleString(
                      'pt-BR',
                      { hour12: false },
                    )
                  : '—'
              }
              mono
            />
            {cessao.pagamento.onChainTxHash && (
              <Row
                label="Audit on-chain"
                value={
                  <a
                    href={txExplorerUrl(cessao.pagamento.onChainTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] underline text-primary-deep hover:text-primary break-all"
                  >
                    {cessao.pagamento.onChainTxHash.slice(0, 12)}…
                  </a>
                }
              />
            )}
          </div>
        </section>
      )}

      {cessao.cota && (
        <section className="mb-12">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-4">
            Cota incorporada ao pool
          </p>
          <div className="border border-light-hairline bg-base text-lightBg px-6 py-6">
            <p className="font-mono text-xs text-lightBg/60">id: {cessao.cota.id}</p>
            <p className="font-title text-2xl font-semibold mt-3 tracking-tight">
              {Number(cessao.cota.tokensEmitidos).toLocaleString('pt-BR')}{' '}
              <span className="text-lightBg/70 text-lg">PLINA-RF emitido</span>
            </p>
            <p className="font-text text-sm text-lightBg/80 mt-3 max-w-prose">
              Sua cota faz parte do pool tokenizado público. Composição
              visível em <a href="/pool" className="underline">/pool</a>.
            </p>
            {cessao.cota.emissaoTxHash && (
              <a
                href={txExplorerUrl(cessao.cota.emissaoTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block border border-lightBg/30 px-4 py-2 font-details text-[10px] tracking-[0.2em] uppercase hover:bg-lightBg/10 transition-colors"
              >
                Emissão Stellar Expert →
              </a>
            )}
          </div>
        </section>
      )}

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
