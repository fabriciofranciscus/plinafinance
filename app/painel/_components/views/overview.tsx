'use client';

/**
 * Visão Geral — hero da posição (PLINA-RF detido, NAV, ownership), composição
 * por classe + wallet + KYC, distribuição lastreada do pool, atividade recente
 * e ações. Inclui o fluxo de liquidação quando há posição. Tudo com dado real
 * de Horizon + /api/pool/summary; sparkline do hero é decorativo.
 */

import {
  BRL,
  NUMBER_BR,
  NUMBER_INT,
  TIPO_BEM_LABEL,
  ACAO_LABEL,
  explorerAccount,
  explorerAsset,
  explorerTx,
} from '../../_lib/format';
import type { PainelData } from '../../_hooks/use-painel-data';
import type { ViewId } from '../sidebar';
import Liquidar from '../liquidar';

interface OverviewProps {
  data: PainelData;
  kycAprovado: boolean;
  kycStatus: string | null;
  onNavigate: (id: ViewId) => void;
}

export default function Overview({
  data,
  kycAprovado,
  kycStatus,
  onNavigate,
}: OverviewProps) {
  const {
    pool,
    events,
    seniorQty,
    subordinadaQty,
    plinarfQty,
    xlmQty,
    navUnit,
    navEquivalent,
    ownershipPct,
    hasPosition,
    stellarAddress,
  } = data;

  const recent = (events ?? []).slice(0, 4);

  return (
    <div>
      {/* HERO */}
      <section>
        <div className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55 mb-3">
          Posição corrente
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-base/15 border border-light-hairline">
          {/* Painel petrol */}
          <div className="md:col-span-7 bg-base text-lightBg px-8 py-10 flex flex-col">
            <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-primary">
              PLINA-RF detido
            </p>
            <p className="font-title text-6xl md:text-7xl font-semibold mt-4 tracking-tight leading-[0.95] tabular-nums">
              {NUMBER_INT.format(plinarfQty)}
            </p>
            <p className="font-mono text-xs text-lightBg/55 mt-3">
              {NUMBER_BR.format(plinarfQty)} unidades · 1 RF = R$ 1,00 na emissão
            </p>
            {/* Stats em grid hairline, não cards — doutrina terminal */}
            <div className="mt-auto pt-8">
              <div className="grid grid-cols-3 divide-x divide-lightBg/15 border-t border-lightBg/15 pt-6">
                <HeroStat label="NAV equivalente" value={BRL.format(navEquivalent)} />
                <HeroStat label="NAV / token" value={NUMBER_BR.format(navUnit)} />
                <HeroStat
                  label="Posição no pool"
                  value={`${ownershipPct.toFixed(2)}%`}
                />
              </div>
            </div>
          </div>

          {/* Painel claro */}
          <div className="md:col-span-5 bg-lightBg px-6 py-7 space-y-6">
            <div>
              <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55">
                Por classe
              </p>
              <div className="mt-3 space-y-3">
                <ClasseRow
                  code="PLINARF"
                  perfil="Sênior"
                  qty={NUMBER_BR.format(seniorQty)}
                />
                <ClasseRow
                  code="PLINARFB"
                  perfil="Subordinada"
                  qty={NUMBER_BR.format(subordinadaQty)}
                />
              </div>
              {pool?.issuerPubkey && (
                <a
                  href={explorerAsset('PLINARF', pool.issuerPubkey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-mono text-xs text-primary-deep hover:text-primary"
                >
                  Sênior no Stellar Expert →
                </a>
              )}
            </div>
            <div className="border-t border-light-hairline pt-5">
              <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55">
                Wallet · custódia Privy
              </p>
              {stellarAddress && (
                <a
                  href={explorerAccount(stellarAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-primary-deep hover:text-primary break-all mt-1 inline-block"
                >
                  {stellarAddress}
                </a>
              )}
              <p className="font-mono text-[11px] text-base/55 mt-2">
                {NUMBER_BR.format(xlmQty)} XLM · gas
              </p>
            </div>
            <div className="border-t border-light-hairline pt-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55">
                  KYC
                </p>
                <p className="font-text text-sm text-base mt-1">
                  {kycAprovado
                    ? 'Investidor verificado'
                    : `KYC ${(kycStatus ?? 'pendente').toLowerCase()}`}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-2 border px-3 py-1.5 ${
                  kycAprovado
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-base/20'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    kycAprovado ? 'bg-primary-deep' : 'bg-base/40'
                  }`}
                />
                <span
                  className={`font-details text-[9px] font-bold tracking-[0.16em] uppercase ${
                    kycAprovado ? 'text-primary-deep' : 'text-base/55'
                  }`}
                >
                  {kycAprovado ? 'Verificado' : 'Pendente'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {!hasPosition && (
          <div className="mt-6 border-t border-light-hairline pt-6">
            <p className="font-text text-sm text-base/70 leading-relaxed max-w-2xl">
              Você ainda não detém PLINA-RF. Cada token representa R$ 1,00 de NAV
              em direito creditório brasileiro contemplado, lastreado pela curva
              de realização acompanhada do FIDC.
            </p>
            <a
              href="/investir"
              className="mt-4 inline-block bg-base text-lightBg font-details text-[10px] font-bold tracking-[0.2em] uppercase px-5 py-2.5 hover:bg-primary-deep transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-lightBg"
            >
              Acessar oferta →
            </a>
          </div>
        )}
      </section>

      {/* LIQUIDAR */}
      {hasPosition && stellarAddress && (
        <section className="mt-14">
          <Liquidar
            stellarAddress={stellarAddress}
            plinarfQty={plinarfQty}
            onDone={data.refresh}
          />
        </section>
      )}

      {/* COMPOSIÇÃO LASTREADA */}
      {pool && pool.cotasCount > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55">
              Composição lastreada · pool consolidado
            </div>
            <button
              onClick={() => onNavigate('cotas')}
              className="font-details text-[9px] font-bold tracking-[0.16em] uppercase text-primary-deep hover:text-primary"
            >
              Ver cotas →
            </button>
          </div>
          <div className="border border-light-hairline">
            <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55 px-5 py-3 border-b border-light-hairline">
              Distribuição por tipo de bem
            </p>
            <ul className="divide-y divide-light-hairline">
              {Object.entries(pool.navPorTipo)
                .sort((a, b) => b[1] - a[1])
                .map(([tipo, nav]) => {
                  const pct = pool.navTotal > 0 ? (nav / pool.navTotal) * 100 : 0;
                  return (
                    <li
                      key={tipo}
                      className="px-5 py-3.5 grid grid-cols-[100px_1fr_120px_56px] items-center gap-4"
                    >
                      <span className="font-text text-sm text-base">
                        {TIPO_BEM_LABEL[tipo] ?? tipo}
                      </span>
                      <div className="h-1.5 bg-base/10 relative">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-right text-base">
                        {BRL.format(nav)}
                      </span>
                      <span className="font-mono text-xs text-right text-base/55">
                        {pct.toFixed(1)}%
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </section>
      )}

      {/* ATIVIDADE + AÇÕES */}
      <section className="mt-14 grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-10 items-start">
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55">
              Atividade auditável
            </div>
            <button
              onClick={() => onNavigate('transactions')}
              className="font-details text-[9px] font-bold tracking-[0.16em] uppercase text-primary-deep hover:text-primary"
            >
              Todas →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="font-text text-sm text-base/55 border-t border-light-hairline pt-4">
              Sem eventos registrados. Toda compra, autorização e clawback deixa
              rastro on-chain rastreável aqui.
            </p>
          ) : (
            <div className="border-t border-light-hairline">
              {recent.map((e) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-4 py-4 border-b border-light-hairline"
                >
                  <span className="font-mono text-[11px] text-base/60">
                    {new Date(e.criadoEm).toLocaleDateString('pt-BR')}
                  </span>
                  <div className="min-w-0">
                    <div className="font-text text-sm text-base">
                      {ACAO_LABEL[e.acao] ?? e.acao}
                    </div>
                    {e.stellarTxHash && (
                      <a
                        href={explorerTx(e.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-primary-deep hover:text-primary"
                      >
                        {e.stellarTxHash.slice(0, 8)}… ↗
                      </a>
                    )}
                  </div>
                  <span className="font-mono text-xs text-base whitespace-nowrap">
                    {payloadAmount(e.payload)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55 mb-3">
            Ações
          </div>
          <div className="flex flex-col gap-px bg-base/15 border border-light-hairline">
            <ActionCard
              href="/investir"
              title={hasPosition ? 'Aumentar posição' : 'Adquirir PLINA-RF'}
              desc="Alocar capital adicional no pool PLINA-RF."
            />
            <ActionButton
              onClick={() => onNavigate('distributions')}
              title="Distribuições"
              desc="Rendimentos mensais e janela de resgate."
            />
            <ActionButton
              onClick={() => onNavigate('documents')}
              title="Documentos"
              desc="Regulamento, prospecto e pareceres."
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function payloadAmount(payload: Record<string, unknown> | null): string {
  if (payload && typeof payload === 'object' && 'amount' in payload) {
    return `${payload.amount} RF`;
  }
  return '';
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="font-details text-[9px] font-bold tracking-[0.18em] uppercase text-lightBg/50">
        {label}
      </p>
      <p className="font-mono text-lg md:text-xl mt-1.5 text-white tabular-nums">
        {value}
      </p>
    </div>
  );
}

function ClasseRow({
  code,
  perfil,
  qty,
}: {
  code: string;
  perfil: string;
  qty: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <p className="font-mono text-sm text-base">{code}</p>
        <p className="font-details text-[9px] font-bold tracking-[0.18em] uppercase text-base/50 mt-0.5">
          {perfil}
        </p>
      </div>
      <p className="font-mono text-base text-base">{qty}</p>
    </div>
  );
}

function ActionCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="group text-left bg-lightBg px-5 py-5 transition-colors duration-200 hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <div className="font-title text-base font-semibold text-base group-hover:text-lightBg transition-colors">
        {title}
      </div>
      <div className="font-text text-[13px] text-base/60 group-hover:text-lightBg/70 mt-1 transition-colors">
        {desc}
      </div>
    </a>
  );
}

function ActionButton({
  onClick,
  title,
  desc,
}: {
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left bg-lightBg px-5 py-5 transition-colors duration-200 hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <div className="font-title text-base font-semibold text-base group-hover:text-lightBg transition-colors">
        {title}
      </div>
      <div className="font-text text-[13px] text-base/60 group-hover:text-lightBg/70 mt-1 transition-colors">
        {desc}
      </div>
    </button>
  );
}
