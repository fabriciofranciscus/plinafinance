'use client';

/**
 * /minha-posicao — extrato institucional do investidor.
 *
 * Estrutura editorial (registro private banking, não dashboard SaaS):
 *   1. Hero — saldo PLINA-RF, NAV equivalente, % ownership do pool.
 *   2. Custódia & Compliance — Privy embedded + AUTH flags + trustline.
 *   3. Composição lastreada — resumo executivo do pool com link pra /pool.
 *   4. Atividade — eventos auditáveis do investidor, cada um com hash.
 *   5. Próximos passos — CTAs (comprar mais, transparência, custódia).
 *
 * Doutrina: hairlines pra estrutura, sandwich tonal, mono pra dados,
 * cyan ≤10% como sinal raro. Sem cards-iguais-com-ícone, sem
 * hero-metric template.
 */

import { usePrivy, useLogin } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';

interface BalanceRow {
  asset_code?: string;
  asset_issuer?: string;
  asset_type: string;
  balance: string;
}

interface EventRow {
  id: string;
  acao: string;
  criadoEm: string;
  stellarTxHash: string | null;
  motivoClawback: string | null;
  fundamentoUrl: string | null;
  payload: Record<string, unknown> | null;
}

interface PoolSummary {
  assetCode: string;
  network: string;
  issuerPubkey: string;
  distributorPubkey: string;
  navTotal: number;
  tokensVivos: number;
  cotasCount: number;
  tipoBemCount: Record<string, number>;
  navPorTipo: Record<string, number>;
}

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const NUMBER_INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const TIPO_BEM_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviço',
};

const ACAO_LABEL: Record<string, string> = {
  COTA_INCORPORADA: 'Cota incorporada ao pool',
  TOKEN_EMITIDO: 'PLINA-RF emitido',
  INVESTIDOR_ONBOARDED: 'Onboarding institucional concluído',
  TRUSTLINE_AUTORIZADA: 'Trustline autorizada pelo issuer',
  TRUSTLINE_REVOGADA: 'Trustline revogada',
  DISTRIBUICAO: 'Aquisição de PLINA-RF',
  CLAWBACK_EXECUTADO: 'Clawback institucional',
  COTA_REALIZADA: 'Cota realizada',
};

const MOTIVO_LABEL: Record<string, string> = {
  DECISAO_JUDICIAL: 'Decisão judicial',
  SANCAO_REGULATORIA: 'Sanção regulatória',
  FRAUDE_DOCUMENTAL: 'Fraude documental',
  ERRO_OPERACIONAL: 'Erro operacional',
};

function explorerAccount(pubkey: string) {
  return `https://stellar.expert/explorer/testnet/account/${pubkey}`;
}
function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
function explorerAsset(code: string, issuer: string) {
  return `https://stellar.expert/explorer/testnet/asset/${code}-${issuer}`;
}

export default function MinhaPosicaoPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const [balances, setBalances] = useState<BalanceRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => a.address.startsWith('G'))?.address ?? null;
  const email =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { email: string } => 'email' in a)
      .find((a) => !!a.email)?.email ?? null;

  const refresh = useCallback(async () => {
    if (!stellarAddress) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const [balancesRes, eventsRes, poolRes] = await Promise.all([
        fetch(`${HORIZON_URL}/accounts/${stellarAddress}`),
        fetch(`/api/investidor/events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
        fetch(`/api/pool/summary`),
      ]);
      const bj = balancesRes.ok
        ? ((await balancesRes.json()) as { balances: BalanceRow[] })
        : { balances: [] };
      const ej = eventsRes.ok
        ? ((await eventsRes.json()) as { events: EventRow[] })
        : { events: [] };
      const pj = poolRes.ok ? ((await poolRes.json()) as PoolSummary) : null;
      setBalances(bj.balances);
      setEvents(ej.events);
      setPool(pj);
      setLastSync(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [stellarAddress, getAccessToken]);

  useEffect(() => {
    if (ready && authenticated && stellarAddress) refresh();
  }, [ready, authenticated, stellarAddress, refresh]);

  if (!ready) {
    return <PageWrap>{null}</PageWrap>;
  }

  if (!authenticated) {
    return (
      <PageWrap>
        <div className="py-16">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Acesso institucional · PLINA-RF
          </p>
          <h1 className="font-title mt-3 text-4xl font-semibold tracking-tight">
            Sua carteira institucional
          </h1>
          <p className="font-text mt-4 text-base/80 max-w-2xl leading-relaxed">
            Esta superfície expõe seu saldo PLINA-RF, sua composição
            lastreada no pool e a atividade auditável da sua posição.
            Faça login pra continuar.
          </p>
          <button
            onClick={() => login()}
            className="mt-8 bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
          >
            Entrar com email institucional
          </button>
        </div>
      </PageWrap>
    );
  }

  const plinarfBal = balances?.find((b) => b.asset_code === 'PLINARF');
  const plinarfQty = Number(plinarfBal?.balance ?? 0);
  const xlmBal = balances?.find((b) => b.asset_type === 'native');
  const xlmQty = Number(xlmBal?.balance ?? 0);

  const ownershipPct =
    pool && pool.tokensVivos > 0 ? (plinarfQty / pool.tokensVivos) * 100 : 0;
  const navEquivalent = plinarfQty;

  const hasPosition = plinarfQty > 0;
  const initialLoading = loading && !balances;

  return (
    <PageWrap>
      {/* Header */}
      <header className="border-b border-light-hairline pb-8 mb-10">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Extrato institucional · {pool?.network ?? 'TESTNET'}
            </p>
            <h1 className="font-title mt-3 text-4xl md:text-5xl font-semibold tracking-tight">
              Sua posição
            </h1>
            {email && (
              <p className="font-text text-base/70 mt-2 text-sm">{email}</p>
            )}
          </div>
          <div className="flex items-center gap-3 font-details text-[10px] tracking-[0.2em] uppercase">
            {lastSync && (
              <span className="text-base/50">
                Sync ·{' '}
                <span className="font-mono text-[11px] normal-case tracking-normal">
                  {lastSync.toLocaleTimeString('pt-BR', { hour12: false })}
                </span>
              </span>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="border border-light-hairline px-3 py-2 hover:bg-base hover:text-lightBg transition-colors disabled:opacity-50"
            >
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
        </div>
      </header>

      {initialLoading && <Skeletons />}
      {error && (
        <div className="border border-red-300 bg-red-50 text-red-800 p-4 text-sm font-text mb-8">
          ✗ {error}
        </div>
      )}

      {!initialLoading && (
        <>
          {/* 1. Hero — composição da posição */}
          <section className="mb-16">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
              Posição corrente
            </p>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-base/15 border border-light-hairline">
              <div className="md:col-span-7 bg-base text-lightBg px-8 py-10">
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
                  PLINA-RF detido
                </p>
                <p className="font-title text-5xl md:text-6xl font-semibold mt-3 tracking-tight">
                  {NUMBER_INT.format(plinarfQty)}
                </p>
                <p className="font-mono text-xs text-lightBg/60 mt-2">
                  {NUMBER_BR.format(plinarfQty)} unidades
                </p>
                <div className="mt-6 pt-6 border-t border-lightBg/15 grid grid-cols-2 gap-6">
                  <div>
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50">
                      NAV equivalente
                    </p>
                    <p className="font-mono text-xl mt-1">{BRL.format(navEquivalent)}</p>
                  </div>
                  <div>
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50">
                      Posição no pool
                    </p>
                    <p className="font-mono text-xl mt-1">
                      {ownershipPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>

              <div className="md:col-span-5 bg-lightBg px-6 py-8 space-y-6">
                <div>
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Asset on-chain
                  </p>
                  <p className="font-mono text-sm mt-1">
                    PLINARF
                    {pool?.issuerPubkey && (
                      <a
                        href={explorerAsset('PLINARF', pool.issuerPubkey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-primary-deep hover:text-primary underline text-xs"
                      >
                        Stellar Expert →
                      </a>
                    )}
                  </p>
                </div>
                <div>
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    Wallet (custódia Privy)
                  </p>
                  {stellarAddress && (
                    <a
                      href={explorerAccount(stellarAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs break-all underline mt-1 inline-block hover:text-primary-deep"
                    >
                      {stellarAddress}
                    </a>
                  )}
                </div>
                <div>
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                    XLM disponível (gas)
                  </p>
                  <p className="font-mono text-sm mt-1">
                    {NUMBER_BR.format(xlmQty)} XLM
                  </p>
                </div>
              </div>
            </div>

            {!hasPosition && (
              <div className="mt-6 border-l-0 border-t border-light-hairline pt-6">
                <p className="font-text text-base/70 text-sm leading-relaxed max-w-2xl">
                  Você ainda não detém PLINA-RF. Cada token representa
                  R$ 1,00 de NAV em direito creditório brasileiro
                  contemplado, lastreado pela curva de realização
                  acompanhada do FIDC.
                </p>
                <a
                  href="/investir"
                  className="mt-4 inline-block bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 hover:bg-primary-deep transition-colors"
                >
                  Acessar oferta →
                </a>
              </div>
            )}
          </section>

          {/* 2. Custódia & Compliance */}
          <section className="mb-16">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
              Custódia & Compliance
            </p>
            <div className="border-y border-light-hairline divide-y divide-light-hairline">
              <ComplianceRow
                label="Custodiante"
                value="Privy embedded wallet · MPC institucional"
                detail="Investidor mantém controle via session Privy. Chaves nunca expostas a frontend nem backend Plina."
              />
              <ComplianceRow
                label="Auth Flags do issuer"
                value="AUTH_REQUIRED · AUTH_REVOCABLE · AUTH_CLAWBACK_ENABLED"
                detail="Trustline autorizada após KYC. Issuer pode revogar autorização e reverter saldos sob política pública linkada no stellar.toml."
              />
              <ComplianceRow
                label="KYC institucional"
                value="Aprovado · Etherfuse sandbox (LATAM)"
                detail="Identidade + documentos + agreements submetidos via API. Em produção, idem em produção Etherfuse."
              />
              <ComplianceRow
                label="Jurisdição"
                value="Brasil · POC operado com capital próprio"
                detail="Sem oferta pública (Lei 11.795/2008). Fase 1 estrutura FIDC formal sob CVM 175 com administrador fiduciário e auditoria big four."
              />
            </div>
          </section>

          {/* 3. Composição lastreada */}
          {pool && pool.cotasCount > 0 && (
            <section className="mb-16">
              <div className="flex items-baseline justify-between mb-4">
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                  Composição lastreada · pool consolidado
                </p>
                <a
                  href="/pool"
                  className="font-details text-[10px] tracking-[0.2em] uppercase underline text-base/70 hover:text-primary-deep"
                >
                  Ver pool completo →
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline mb-4">
                <Metric label="NAV total do pool" value={BRL.format(pool.navTotal)} />
                <Metric
                  label="PLINA-RF emitido"
                  value={NUMBER_INT.format(pool.tokensVivos)}
                />
                <Metric
                  label="Cotas ativas"
                  value={String(pool.cotasCount)}
                  sublabel={`${Object.entries(pool.tipoBemCount)
                    .map(
                      ([k, v]) => `${v} ${(TIPO_BEM_LABEL[k] ?? k).toLowerCase()}`,
                    )
                    .join(' · ')}`}
                />
              </div>

              <div className="border border-light-hairline">
                <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 px-4 py-3 border-b border-light-hairline">
                  Distribuição por tipo de bem
                </p>
                <ul className="divide-y divide-light-hairline">
                  {Object.entries(pool.navPorTipo)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tipo, nav]) => {
                      const pct = (nav / pool.navTotal) * 100;
                      return (
                        <li
                          key={tipo}
                          className="px-4 py-3 grid grid-cols-[100px_1fr_120px_60px] items-center gap-4"
                        >
                          <span className="font-text text-sm">
                            {TIPO_BEM_LABEL[tipo] ?? tipo}
                          </span>
                          <div className="h-1.5 bg-base/10 relative">
                            <div
                              className="absolute inset-y-0 left-0 bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-right">
                            {BRL.format(nav)}
                          </span>
                          <span className="font-mono text-xs text-right text-base/60">
                            {pct.toFixed(1)}%
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
              <p className="font-text text-xs text-base/60 mt-3 max-w-2xl">
                Identificadores das cotas (administradora, número de grupo,
                titularidade) ficam off-chain sob custódia do gestor do FIDC.
                On-chain expomos NAV, hash de emissão e endereços públicos.
              </p>
            </section>
          )}

          {/* 4. Atividade */}
          <section className="mb-16">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
              Atividade auditável
            </p>
            {events && events.length === 0 ? (
              <p className="font-text text-sm text-base/60">
                Sem eventos registrados. Toda compra, autorização e clawback
                deixa rastro on-chain rastreável aqui.
              </p>
            ) : (
              <ol className="border-y border-light-hairline">
                {events?.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ol>
            )}
          </section>

          {/* 5. Próximos passos */}
          <section className="mb-8 border-t border-light-hairline pt-10">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-6">
              Próximos passos
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
              <NextStep
                label={hasPosition ? 'Aumentar posição' : 'Adquirir PLINA-RF'}
                description={
                  hasPosition
                    ? 'Compre tokens adicionais via Etherfuse + Stellar.'
                    : 'Onboarding institucional + onramp BRL/PIX → TESOURO → PLINA-RF.'
                }
                href="/investir"
                cta="Comprar"
              />
              <NextStep
                label="Verificar transparência"
                description="Composição do pool, NAV diário, hashes de emissão. Auditável em tempo real."
                href="/pool"
                cta="Pool público"
              />
              <NextStep
                label="Política institucional"
                description="Quatro hipóteses exclusivas de clawback. Linkada no stellar.toml SEP-0001."
                href="/politica-clawback"
                cta="Ler política"
              />
            </div>
          </section>
        </>
      )}
    </PageWrap>
  );
}

function PageWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">{children}</div>
  );
}

function Metric({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-lightBg px-5 py-6">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      <p className="font-title text-2xl md:text-3xl font-semibold mt-2 tracking-tight">
        {value}
      </p>
      {sublabel && (
        <p className="font-text text-xs text-base/60 mt-2">{sublabel}</p>
      )}
    </div>
  );
}

function ComplianceRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-2 md:gap-6 py-4">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 pt-1">
        {label}
      </span>
      <div>
        <p className="font-text text-sm">{value}</p>
        {detail && (
          <p className="font-text text-xs text-base/60 mt-1 leading-relaxed max-w-2xl">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventRow }) {
  const label = ACAO_LABEL[event.acao] ?? event.acao;
  const isClawback = event.acao === 'CLAWBACK_EXECUTADO';
  return (
    <li
      className={`relative px-4 py-5 border-b border-light-hairline last:border-b-0 grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-2 md:gap-6 ${
        isClawback ? 'bg-base/5' : ''
      }`}
    >
      <div>
        <p className="font-mono text-[11px] text-base/70">
          {new Date(event.criadoEm).toLocaleString('pt-BR', { hour12: false })}
        </p>
        <p className="font-details text-[10px] tracking-[0.2em] uppercase mt-1 text-base/60">
          {event.acao}
        </p>
      </div>
      <div>
        <p className={`font-text text-sm ${isClawback ? 'font-semibold' : ''}`}>
          {label}
        </p>
        {event.motivoClawback && (
          <p className="font-text text-xs text-base/70 mt-1">
            Motivo:{' '}
            <span className="font-mono">
              {MOTIVO_LABEL[event.motivoClawback] ?? event.motivoClawback}
            </span>
            {event.fundamentoUrl && (
              <>
                {' · '}
                <a
                  href={event.fundamentoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-base/30 hover:decoration-primary"
                >
                  fundamento jurídico
                </a>
              </>
            )}
          </p>
        )}
        {event.payload &&
          typeof event.payload === 'object' &&
          'amount' in event.payload && (
            <p className="font-mono text-xs text-base/60 mt-1">
              Quantidade: {String(event.payload.amount)} PLINARF
            </p>
          )}
      </div>
      {event.stellarTxHash && (
        <a
          href={explorerTx(event.stellarTxHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-base/60 hover:text-primary-deep md:text-right md:self-start break-all md:whitespace-nowrap"
        >
          {event.stellarTxHash.slice(0, 12)}… ↗
        </a>
      )}
    </li>
  );
}

function NextStep({
  label,
  description,
  href,
  cta,
}: {
  label: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <a
      href={href}
      className="group bg-lightBg px-6 py-7 hover:bg-base hover:text-lightBg transition-colors block"
    >
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 group-hover:text-lightBg/60">
        {label}
      </p>
      <p className="font-text text-sm mt-2 leading-relaxed max-w-prose">
        {description}
      </p>
      <p className="font-details text-[10px] tracking-[0.2em] uppercase mt-4 underline decoration-base/30 group-hover:decoration-primary">
        {cta} →
      </p>
    </a>
  );
}

function Skeletons() {
  return (
    <div className="space-y-12 animate-pulse">
      <div>
        <div className="h-3 w-32 bg-base/10 rounded-full mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-base/15 border border-light-hairline">
          <div className="md:col-span-7 bg-base/10 h-56" />
          <div className="md:col-span-5 bg-base/5 h-56" />
        </div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-base/5" />
        ))}
      </div>
    </div>
  );
}
