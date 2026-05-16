'use client';

/**
 * /minha-posicao — view do investidor.
 *
 * Lê saldo PLINARF + XLM via Horizon (público, sem auth). Lista eventos
 * do investidor (audit log filtrado). Atualiza no client (Privy session)
 * — exige login.
 */

import { usePrivy, useLogin } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';

interface BalanceRow {
  asset_code?: string;
  asset_issuer?: string;
  asset_type: string;
  balance: string;
}

interface PositionData {
  publicKey: string;
  balances: BalanceRow[];
  events: Array<{
    id: string;
    acao: string;
    criadoEm: string;
    stellarTxHash: string | null;
    motivoClawback: string | null;
    fundamentoUrl: string | null;
    payload: Record<string, unknown> | null;
  }>;
}

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

function explorerAccount(pubkey: string) {
  return `https://stellar.expert/explorer/testnet/account/${pubkey}`;
}
function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export default function MinhaPosicaoPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const [data, setData] = useState<PositionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => a.address.startsWith('G'))?.address ?? null;

  useEffect(() => {
    if (!ready || !authenticated || !stellarAddress) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('sessão Privy expirada');
        const [balancesRes, eventsRes] = await Promise.all([
          fetch(`${HORIZON_URL}/accounts/${stellarAddress}`),
          fetch(`/api/investidor/events`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (cancelled) return;
        const balancesJson = balancesRes.ok
          ? ((await balancesRes.json()) as { balances: BalanceRow[] })
          : { balances: [] };
        const eventsJson = eventsRes.ok
          ? ((await eventsRes.json()) as { events: PositionData['events'] })
          : { events: [] };
        setData({
          publicKey: stellarAddress,
          balances: balancesJson.balances,
          events: eventsJson.events,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, stellarAddress, getAccessToken]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-text text-sm text-base/70">Carregando…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Acesso institucional
        </p>
        <h1 className="font-title mt-3 text-3xl font-semibold tracking-tight">
          Sua posição PLINA-RF
        </h1>
        <p className="font-text mt-4 text-base/80">
          Faça login para ver sua carteira institucional.
        </p>
        <button
          onClick={() => login()}
          className="mt-6 bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-6 py-3"
        >
          Entrar
        </button>
      </div>
    );
  }

  const plinarf =
    data?.balances.find((b) => b.asset_code === 'PLINARF')?.balance ?? '0';
  const xlm = data?.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
      <header className="mb-10 border-b border-light-hairline pb-8">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Carteira institucional
        </p>
        <h1 className="font-title mt-3 text-3xl md:text-4xl font-semibold tracking-tight">
          Sua posição
        </h1>
        {data && (
          <a
            href={explorerAccount(data.publicKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-mono text-xs text-base/60 hover:text-primary break-all"
          >
            {data.publicKey} ↗
          </a>
        )}
      </header>

      {loading && !data && <Skeletons />}

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-800 p-4 text-sm font-text mb-8">
          ✗ {error}
        </div>
      )}

      {data && (
        <>
          <section className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
            <div className="bg-lightBg px-6 py-8">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                PLINA-RF detido
              </p>
              <p className="font-title text-4xl md:text-5xl font-semibold mt-3 tracking-tight">
                {NUMBER_BR.format(Number(plinarf))}
              </p>
              <p className="font-text text-xs text-base/60 mt-2">
                NAV equivalente ≈ R$ {NUMBER_BR.format(Number(plinarf))}
              </p>
            </div>
            <div className="bg-lightBg px-6 py-8">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                XLM (gas)
              </p>
              <p className="font-title text-2xl font-semibold mt-3 tracking-tight">
                {NUMBER_BR.format(Number(xlm))}
              </p>
              <p className="font-text text-xs text-base/60 mt-2">
                Fee de transações Stellar.
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="font-title text-xl font-semibold mb-4 tracking-tight">
              Eventos
            </h2>
            {data.events.length === 0 ? (
              <p className="font-text text-sm text-base/60">
                Sem eventos ainda. Vá em{' '}
                <a href="/investir" className="underline">
                  /investir
                </a>{' '}
                pra comprar PLINA-RF.
              </p>
            ) : (
              <ol className="border-y border-light-hairline">
                {data.events.map((e) => (
                  <li
                    key={e.id}
                    className="border-b border-light-hairline last:border-b-0 py-4 grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 md:gap-4 text-sm"
                  >
                    <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
                      {e.acao}
                    </span>
                    <div className="font-text text-xs text-base/70">
                      <p className="font-mono text-[11px]">
                        {new Date(e.criadoEm).toLocaleString('pt-BR', {
                          hour12: false,
                        })}
                      </p>
                      {e.motivoClawback && (
                        <p className="mt-1">
                          Motivo:{' '}
                          <span className="font-mono">{e.motivoClawback}</span>
                          {e.fundamentoUrl && (
                            <>
                              {' · '}
                              <a
                                href={e.fundamentoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                fundamento
                              </a>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    {e.stellarTxHash && (
                      <a
                        href={explorerTx(e.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-base/60 hover:text-primary md:text-right break-all"
                      >
                        {e.stellarTxHash.slice(0, 12)}…
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-base/15 border border-light-hairline">
        <div className="bg-lightBg px-6 py-8">
          <div className="h-3 w-24 bg-base/10 rounded-full" />
          <div className="h-10 w-40 bg-base/15 mt-4" />
          <div className="h-3 w-32 bg-base/10 mt-3" />
        </div>
        <div className="bg-lightBg px-6 py-8">
          <div className="h-3 w-20 bg-base/10 rounded-full" />
          <div className="h-7 w-28 bg-base/15 mt-4" />
        </div>
      </div>
      <div className="border-y border-light-hairline">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-b border-light-hairline last:border-b-0 py-4 grid grid-cols-3 gap-4"
          >
            <div className="h-3 bg-base/10 rounded-full" />
            <div className="h-3 bg-base/10 rounded-full" />
            <div className="h-3 bg-base/10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
