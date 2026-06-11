'use client';

/**
 * use-painel-data — busca posição/eventos/pool do investidor logado.
 *
 * Espelha o refresh() do antigo /minha-posicao: saldos via Horizon (público),
 * eventos auditáveis via /api/investidor/events (Bearer Privy) e resumo do pool
 * via /api/pool/summary (envelope { data, error }). Deriva os números de
 * posição (qty por classe, NAV equivalente, ownership) prontos pra UI.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';

export interface BalanceRow {
  asset_code?: string;
  asset_issuer?: string;
  asset_type: string;
  balance: string;
}

export interface EventRow {
  id: string;
  acao: string;
  criadoEm: string;
  stellarTxHash: string | null;
  motivoClawback: string | null;
  fundamentoUrl: string | null;
  payload: Record<string, unknown> | null;
}

export interface PoolSummary {
  assetCode: string;
  network: string;
  issuerPubkey: string;
  distributorPubkey: string;
  navTotal: number;
  tokensVivos: number;
  navPorToken: number;
  caixaRealizado: number;
  spreadRealizadoAcumulado: number;
  realizacoesCount: number;
  cotasCount: number;
  tipoBemCount: Record<string, number>;
  navPorTipo: Record<string, number>;
}

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

export interface PainelData {
  loading: boolean;
  error: string | null;
  lastSync: Date | null;
  refresh: () => Promise<void>;

  stellarAddress: string | null;
  email: string | null;
  investidorId: string | null;

  balances: BalanceRow[] | null;
  events: EventRow[] | null;
  pool: PoolSummary | null;

  // Derivados de posição
  seniorQty: number;
  subordinadaQty: number;
  plinarfQty: number;
  xlmQty: number;
  navUnit: number;
  navEquivalent: number;
  ownershipPct: number;
  hasPosition: boolean;
}

export function usePainelData(): PainelData {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [balances, setBalances] = useState<BalanceRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [investidorId, setInvestidorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => StrKey.isValidEd25519PublicKey(a.address))?.address ?? null;
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
        ? ((await eventsRes.json()) as {
            events: EventRow[];
            investidorId: string | null;
          })
        : { events: [], investidorId: null };
      const pj = poolRes.ok
        ? ((await poolRes.json()) as { data: PoolSummary; error: null }).data
        : null;
      setBalances(bj.balances);
      setEvents(ej.events);
      setInvestidorId(ej.investidorId);
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

  // F-M3-8 — saldo por classe (Sênior PLINARF + Subordinada PLINARFB).
  const seniorQty = Number(
    balances?.find((b) => b.asset_code === 'PLINARF')?.balance ?? 0,
  );
  const subordinadaQty = Number(
    balances?.find((b) => b.asset_code === 'PLINARFB')?.balance ?? 0,
  );
  const plinarfQty = seniorQty + subordinadaQty;
  const xlmQty = Number(
    balances?.find((b) => b.asset_type === 'native')?.balance ?? 0,
  );

  const navUnit = pool?.navPorToken ?? 1;
  const navEquivalent = plinarfQty * navUnit;
  const ownershipPct =
    pool && pool.tokensVivos > 0 ? (plinarfQty / pool.tokensVivos) * 100 : 0;

  return {
    loading,
    error,
    lastSync,
    refresh,
    stellarAddress,
    email,
    investidorId,
    balances,
    events,
    pool,
    seniorQty,
    subordinadaQty,
    plinarfQty,
    xlmQty,
    navUnit,
    navEquivalent,
    ownershipPct,
    hasPosition: plinarfQty > 0,
  };
}
