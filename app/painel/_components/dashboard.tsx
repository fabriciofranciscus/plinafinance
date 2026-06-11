'use client';

/**
 * Dashboard do investidor — console strip enxuto (rede · sync · clawback) +
 * grid [sidebar | main] trocando entre as 6 telas. Mantém o chrome do app
 * (AppHeader/AppFooter); o header próprio do mockup foi descartado.
 */

import { useState } from 'react';
import { usePainelData } from '../_hooks/use-painel-data';
import Sidebar, { type ViewId } from './sidebar';
import Overview from './views/overview';
import Cotas from './views/cotas';
import Kyc from './views/kyc';
import Transactions from './views/transactions';
import Distributions from './views/distributions';
import Documents from './views/documents';

interface DashboardProps {
  nome: string | null;
  papeis: string[];
  kycAprovado: boolean;
  kycStatus: string | null;
}

export default function Dashboard({
  nome,
  papeis,
  kycAprovado,
  kycStatus,
}: DashboardProps) {
  const data = usePainelData();
  const [view, setView] = useState<ViewId>('overview');
  const initialLoading = data.loading && !data.balances;

  const network = data.pool?.network ?? 'TESTNET';
  const papelLabel = papeis.includes('INVESTIDOR')
    ? 'Investidor'
    : papeis.length > 0
      ? papeis[0].charAt(0) + papeis[0].slice(1).toLowerCase()
      : 'Conta';

  return (
    <div className="bg-lightBg min-h-screen">
      {/* Console strip */}
      <div className="bg-base">
        <div className="w-full px-6 lg:px-10 py-2 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="font-details text-[9px] font-bold tracking-[0.22em] uppercase text-secondaryLight">
              Stellar {network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}
            </span>
            {data.lastSync && (
              <span className="font-mono text-[10px] tracking-wide text-secondaryLight/55">
                NAV ·{' '}
                {data.lastSync.toLocaleTimeString('pt-BR', { hour12: false })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 font-mono text-[10px] tracking-wide text-secondaryLight/55">
            <span className="text-primary">AUTH_CLAWBACK_ENABLED</span>
            <button
              onClick={data.refresh}
              disabled={data.loading}
              className="font-details text-[9px] font-bold tracking-[0.18em] uppercase text-secondaryLight hover:text-white transition-colors duration-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              {data.loading ? 'Sincronizando…' : 'Atualizar'}
            </button>
          </div>
        </div>
      </div>

      <div className="w-full px-6 lg:px-10 py-8 md:py-10">
        {data.error && (
          <div className="border border-red-300 bg-red-50 text-red-800 p-4 text-sm font-text mb-6">
            ✗ {data.error}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-8">
          <Sidebar
            active={view}
            onSelect={setView}
            nome={nome}
            papelLabel={papelLabel}
          />

          <main className="flex-1 min-w-0">
            {initialLoading ? (
              <OverviewSkeleton />
            ) : (
              <>
                {view === 'overview' && (
                  <Overview
                    data={data}
                    kycAprovado={kycAprovado}
                    kycStatus={kycStatus}
                    onNavigate={setView}
                  />
                )}
                {view === 'cotas' && <Cotas data={data} />}
                {view === 'kyc' && (
                  <Kyc kycAprovado={kycAprovado} kycStatus={kycStatus} />
                )}
                {view === 'transactions' && <Transactions data={data} />}
                {view === 'distributions' && <Distributions />}
                {view === 'documents' && <Documents />}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Skeleton da carga inicial — espelha a estrutura do hero da Visão Geral. */
function OverviewSkeleton() {
  return (
    <div
      className="animate-pulse motion-reduce:animate-none"
      aria-busy="true"
      aria-label="Carregando posição"
    >
      <div className="h-2.5 w-28 bg-base/15 mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-base/15 border border-light-hairline">
        <div className="md:col-span-7 bg-base/90 px-8 py-10">
          <div className="h-2.5 w-32 bg-lightBg/20" />
          <div className="h-14 w-56 bg-lightBg/15 mt-5" />
          <div className="h-2 w-44 bg-lightBg/15 mt-4" />
          <div className="grid grid-cols-3 gap-4 mt-10 pt-6 border-t border-lightBg/15">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="h-2 w-16 bg-lightBg/15" />
                <div className="h-5 w-20 bg-lightBg/15 mt-2" />
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-5 bg-white px-6 py-7 space-y-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-2 w-24 bg-base/10" />
              <div className="h-4 w-40 bg-base/10" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-10 border border-light-hairline divide-y divide-light-hairline">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-4 flex items-center gap-4">
            <div className="h-3 w-20 bg-base/10" />
            <div className="h-1.5 flex-1 bg-base/10" />
            <div className="h-3 w-24 bg-base/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
