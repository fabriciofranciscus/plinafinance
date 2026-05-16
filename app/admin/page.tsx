/**
 * /admin — painel da operação Plina.
 *
 * Auth guard via cookie (lib/auth/admin). Se não autenticado, renderiza
 * LoginForm. Se autenticado, renderiza dashboard com:
 *   - Snapshot ParametrosPool
 *   - Form incorporar cota nova (emite on-chain)
 *   - Lista de cotas + status
 *   - Lista de investidores + clawback form
 *   - Audit log recente
 *
 * Tudo Server Component. Forms ficam em Client Components separados
 * (useActionState).
 */

import { db } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { accountExplorerUrl, assetExplorerUrl, txExplorerUrl } from '@/lib/stellar/config';
import { navDaCota, navTotalDoPool, tokensEmitidosVivos } from '@/lib/services/pool';
import { LoginForm } from './login-form';
import { IncorporarCotaForm } from './incorporar-cota-form';
import { ClawbackForm } from './clawback-form';
import { logoutAction } from './actions';

export const dynamic = 'force-dynamic';

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}
function tokenFmt(value: number | string | { toString(): string }): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Number(value.toString()),
  );
}

const STATUS_COTA_LABEL: Record<string, string> = {
  DISPONIVEL: 'Disponível',
  RESERVADA: 'Reservada',
  REALIZADA: 'Realizada',
  REVERTIDA: 'Revertida',
};

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    return <LoginForm />;
  }

  const [parametros, cotas, investidores, eventos] = await Promise.all([
    db.parametrosPool.findUnique({ where: { id: 'singleton' } }),
    db.cota.findMany({ orderBy: { criadaEm: 'asc' } }),
    db.investidor.findMany({ orderBy: { criadoEm: 'asc' } }),
    db.eventoAudit.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 20,
      include: { cota: true, investidor: true },
    }),
  ]);

  const navTotal = navTotalDoPool(cotas);
  const tokensVivos = tokensEmitidosVivos(cotas);

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'incorporar', label: 'Incorporar' },
    { id: 'cotas', label: `Cotas (${cotas.length})` },
    { id: 'investidores', label: `Investidores (${investidores.length})` },
    { id: 'audit', label: 'Audit log' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header id="overview" className="mb-8 flex items-start justify-between scroll-mt-24">
        <div>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Operação · acesso restrito · {parametros?.network ?? 'sem pool'}
          </p>
          <h1 className="font-title mt-2 text-3xl font-semibold tracking-tight">
            Painel Plina
          </h1>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="font-details text-[10px] tracking-[0.2em] uppercase border border-light-hairline px-4 py-2 hover:bg-base hover:text-lightBg transition-colors"
          >
            Sair
          </button>
        </form>
      </header>

      <nav className="sticky top-14 z-30 -mx-6 px-6 mb-10 bg-lightBg/95 backdrop-blur border-b border-light-hairline">
        <ul className="flex gap-1 md:gap-2 overflow-x-auto py-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block whitespace-nowrap font-details text-[10px] tracking-[0.2em] uppercase font-bold px-3 py-2 text-base/70 hover:text-base hover:bg-document-grey transition-colors"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {parametros && (
        <section className="mb-12 grid grid-cols-1 md:grid-cols-4 gap-px bg-base/15 border border-light-hairline">
          <Metric label="NAV total ativo" value={brl(navTotal)} />
          <Metric label={`${parametros.assetCode} vivos`} value={tokenFmt(tokensVivos)} />
          <Metric label="Cotas" value={String(cotas.length)} />
          <Metric label="Investidores" value={String(investidores.length)} />
        </section>
      )}

      {/* Issuer / Distributor */}
      {parametros && (
        <section className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-6 font-text text-xs">
          <KvPubkey
            label="Issuer"
            pubkey={parametros.issuerPubkey}
            extraLink={{
              label: 'Asset Stellar Expert →',
              url: assetExplorerUrl(parametros.issuerPubkey),
            }}
          />
          <KvPubkey label="Distributor" pubkey={parametros.distributorPubkey} />
        </section>
      )}

      <section id="incorporar" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-2xl font-semibold mb-4 tracking-tight">
          Incorporar nova cota
        </h2>
        <p className="font-text text-sm text-base/70 mb-6 max-w-2xl">
          Emite PLINA-RF on-chain (issuer → distributor) e persiste a cota no pool.
          Operação real na testnet — irreversível.
        </p>
        <IncorporarCotaForm />
      </section>

      <section id="cotas" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-2xl font-semibold mb-4 tracking-tight">
          Cotas ({cotas.length})
        </h2>
        <div className="border border-light-hairline overflow-x-auto">
          <table className="w-full font-text text-sm">
            <thead className="bg-base text-lightBg">
              <tr>
                <Th>Tipo</Th>
                <Th>Administradora</Th>
                <Th>Valor</Th>
                <Th>Deságio aq.</Th>
                <Th>NAV</Th>
                <Th>Tokens</Th>
                <Th>Status</Th>
                <Th>Emissão</Th>
              </tr>
            </thead>
            <tbody>
              {cotas.map((c) => {
                const nav = navDaCota({
                  valorCarta: c.valorCarta,
                  desagioAquisicao: c.desagioAquisicao,
                });
                return (
                  <tr key={c.id} className="border-t border-light-hairline">
                    <Td>{c.tipoBem}</Td>
                    <Td>{c.administradora}</Td>
                    <Td mono>{brl(Number(c.valorCarta))}</Td>
                    <Td mono>
                      {(Number(c.desagioAquisicao) * 100).toFixed(2)}%
                    </Td>
                    <Td mono>{brl(nav)}</Td>
                    <Td mono>{tokenFmt(c.tokensEmitidos)}</Td>
                    <Td>
                      <span className="font-details text-[10px] tracking-[0.15em] uppercase">
                        {STATUS_COTA_LABEL[c.status] ?? c.status}
                      </span>
                    </Td>
                    <Td>
                      {c.emissaoTxHash ? (
                        <a
                          href={txExplorerUrl(c.emissaoTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] underline"
                        >
                          {c.emissaoTxHash.slice(0, 8)}…
                        </a>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                );
              })}
              {cotas.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-base/60">
                    Nenhuma cota no pool.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="investidores" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-2xl font-semibold mb-4 tracking-tight">
          Investidores ({investidores.length})
        </h2>
        {investidores.length === 0 ? (
          <p className="font-text text-sm text-base/70">
            Nenhum investidor onboarded ainda. Quando alguém usar{' '}
            <code className="font-mono text-xs">/investir</code> e concluir
            KYC, aparece aqui com opção de clawback.
          </p>
        ) : (
          <div className="space-y-4">
            {investidores.map((inv) => (
              <div
                key={inv.id}
                className="border border-light-hairline p-4 space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-text">
                  <div>
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                      Email
                    </p>
                    <p>{inv.email}</p>
                  </div>
                  <div>
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                      Public key
                    </p>
                    <a
                      href={accountExplorerUrl(inv.publicKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs break-all underline"
                    >
                      {inv.publicKey}
                    </a>
                  </div>
                  <div>
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                      Saldo esperado
                    </p>
                    <p className="font-mono">{tokenFmt(inv.saldoEsperado)}</p>
                    <p className="font-details text-[10px] tracking-[0.15em] uppercase text-base/60">
                      {inv.status}
                    </p>
                  </div>
                </div>
                <ClawbackForm
                  investidorId={inv.id}
                  investidorEmail={inv.email}
                  saldoEsperado={tokenFmt(inv.saldoEsperado)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="audit" className="scroll-mt-32">
        <h2 className="font-title text-2xl font-semibold mb-4 tracking-tight">
          Audit log (últimos 20)
        </h2>
        <div className="border border-light-hairline overflow-x-auto">
          <table className="w-full font-text text-sm">
            <thead className="bg-base text-lightBg">
              <tr>
                <Th>Quando</Th>
                <Th>Ação</Th>
                <Th>Operador</Th>
                <Th>Cota</Th>
                <Th>Investidor</Th>
                <Th>Motivo</Th>
                <Th>Tx</Th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.id} className="border-t border-light-hairline">
                  <Td mono>
                    {new Date(e.criadoEm).toLocaleString('pt-BR', {
                      hour12: false,
                    })}
                  </Td>
                  <Td>
                    <span className="font-details text-[10px] tracking-[0.15em] uppercase">
                      {e.acao}
                    </span>
                  </Td>
                  <Td>{e.operador ?? '—'}</Td>
                  <Td mono>{e.cotaId?.slice(0, 8) ?? '—'}</Td>
                  <Td>{e.investidor?.email ?? '—'}</Td>
                  <Td>{e.motivoClawback ?? '—'}</Td>
                  <Td>
                    {e.stellarTxHash ? (
                      <a
                        href={txExplorerUrl(e.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] underline"
                      >
                        {e.stellarTxHash.slice(0, 8)}…
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
              {eventos.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-base/60">
                    Sem eventos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-lightBg px-5 py-6">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      <p className="font-title text-2xl font-semibold mt-2 tracking-tight">{value}</p>
    </div>
  );
}

function KvPubkey({
  label,
  pubkey,
  extraLink,
}: {
  label: string;
  pubkey: string;
  extraLink?: { label: string; url: string };
}) {
  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-1">
        {label}
      </p>
      <a
        href={accountExplorerUrl(pubkey)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] break-all underline decoration-base/30 hover:decoration-primary"
      >
        {pubkey}
      </a>
      {extraLink && (
        <p className="mt-1">
          <a
            href={extraLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] underline"
          >
            {extraLink.label}
          </a>
        </p>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-details text-[10px] tracking-[0.15em] uppercase font-semibold">
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
  );
}
