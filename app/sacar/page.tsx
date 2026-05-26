'use client';

/**
 * /sacar — espelho de /investir mas no sentido inverso (off-ramp).
 *
 * Flow: TESOURO em trustline → quote TESOURO→BRL → createOffRamp →
 * poll signing-tx (burn XDR) → Privy raw-hash sign → submit Horizon →
 * poll status até `processing` (terminal upstream Etherfuse PIX/BRL).
 *
 * Pré-req: investidor onboardado + KYC approved + bank PIX registrado
 * (vide /investir → step 'banking') + saldo TESOURO > 0 (vide /investir
 * step 'claiming').
 */

import {
  useAppPrivy as usePrivy,
  useAppSignRawHash as useSignRawHash,
} from '@/lib/hooks/privy';
import { useCallback, useEffect, useState } from 'react';

const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

interface QuoteData {
  quoteId: string;
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  fee: string;
  expiresAt: string;
}

interface OffRampData {
  orderId: string;
  status: string;
  mock: boolean;
}

interface OffRampStatusData {
  status: string;
  burnStellarTxHash: string | null;
  settledAt: string | null;
  mock: boolean;
}

type Step = 'quote' | 'order' | 'signing' | 'processing' | 'done';

export default function SacarPage() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const { signRawHash } = useSignRawHash();

  const [step, setStep] = useState<Step>('quote');
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [amountTesouro, setAmountTesouro] = useState('10');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [offRamp, setOffRamp] = useState<OffRampData | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [burning, setBurning] = useState(false);
  const [burnTxHash, setBurnTxHash] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<OffRampStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pubkey + customerId via onboard endpoint (idempotente — apenas leitura
  // efetiva pra wallets já onboarded).
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Sessão Privy expirada.');
        const res = await fetch('/api/investidor/onboard', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          publicKey: string;
          etherfuseCustomerId: string;
        };
        if (!cancelled) {
          setPubkey(data.publicKey);
          setCustomerId(data.etherfuseCustomerId);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken]);

  const refreshQuote = useCallback(async () => {
    if (!customerId || !pubkey) return;
    const v = Number(amountTesouro);
    if (!Number.isFinite(v) || v <= 0) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // /quote endpoint hoje aceita amountBrl pra BRL→TESOURO.
          // Pra TESOURO→BRL: amountTesouro + direction='offramp'.
          amountTesouro: v.toFixed(7),
          direction: 'offramp',
          customerId,
          stellarAddress: pubkey,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setQuote((await res.json()) as QuoteData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuoteLoading(false);
    }
  }, [customerId, pubkey, amountTesouro, getAccessToken]);

  useEffect(() => {
    if (step !== 'quote' || !customerId) return;
    const t = setTimeout(() => {
      void refreshQuote();
    }, 600);
    return () => clearTimeout(t);
  }, [amountTesouro, step, customerId, refreshQuote]);

  const createOffRamp = useCallback(async () => {
    if (!quote) return;
    setOrderLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/offramp/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as OffRampData;
      setOffRamp(data);
      setStep('signing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOrderLoading(false);
    }
  }, [quote, getAccessToken]);

  const burnAndSubmit = useCallback(async () => {
    if (!offRamp || !pubkey) return;
    setBurning(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const buildRes = await fetch('/api/investidor/buy/offramp/signing-tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId: offRamp.orderId }),
      });
      if (!buildRes.ok) throw new Error(await buildRes.text());
      const built = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
      };
      const { signature } = await signRawHash({
        address: pubkey,
        chainType: 'stellar',
        hash: built.hashHex as `0x${string}`,
      });
      const submitRes = await fetch('/api/investidor/buy/offramp/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: offRamp.orderId,
          xdr: built.xdr,
          signatureHex: signature,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      const data = (await submitRes.json()) as { burnStellarTxHash: string };
      setBurnTxHash(data.burnStellarTxHash);
      setStep('processing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBurning(false);
    }
  }, [offRamp, pubkey, signRawHash, getAccessToken]);

  // Poll off-ramp status até processing (terminal aceito em PIX/BRL).
  useEffect(() => {
    if (step !== 'processing' || !offRamp) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `/api/investidor/buy/offramp/status?orderId=${encodeURIComponent(offRamp.orderId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const data = (await res.json()) as OffRampStatusData;
        if (cancelled) return;
        setFinalStatus(data);
        if (data.status === 'processing' || data.status === 'completed') {
          setStep('done');
        }
      } catch {
        // retry next tick
      }
    };
    void tick();
    const id = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, offRamp, getAccessToken]);

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando Privy…
        </p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          Sacar BRL · TESOURO → PIX
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold text-base max-w-xl">
          Faça login pra sacar seu saldo TESOURO em BRL via PIX.
        </h1>
        <button
          onClick={() => login()}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors"
        >
          Entrar com Privy
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8 bg-lightBg border-y border-base/15 px-5 py-3 flex items-center gap-3">
        <span
          className="w-1.5 h-1.5 rounded-full bg-primary-deep flex-shrink-0"
          aria-hidden
        />
        <p className="font-details text-[10px] tracking-[0.25em] uppercase text-base">
          Stellar testnet · não é mainnet · PIX sandbox não settla pra banco real
        </p>
      </div>

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        Sacar BRL · TESOURO → PIX
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {step === 'quote' && 'Cotação TESOURO → BRL'}
        {step === 'signing' && 'Assine o burn da Etherfuse'}
        {step === 'processing' && 'Etherfuse confirmando burn…'}
        {step === 'done' && 'Off-ramp em processing'}
      </h1>

      {step === 'quote' && (
        <div className="mt-10">
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Valor TESOURO a sacar
            </span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amountTesouro}
              onChange={(e) => setAmountTesouro(e.target.value)}
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-2xl text-base focus:outline-none focus:border-base"
            />
          </label>

          {quote && (
            <div className="mt-12">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mb-4">
                Breakdown
              </p>
              <dl className="grid grid-cols-2 gap-px bg-base/10 border-y border-base/15">
                <Cell k="Você queima" v={`${NUMBER_BR.format(Number(quote.fromAmount))} TESOURO`} />
                <Cell k="Receberá" v={BRL.format(Number(quote.toAmount))} accent />
                <Cell k="Câmbio" v={NUMBER_BR.format(Number(quote.exchangeRate))} />
                <Cell k="Fee" v={BRL.format(Number(quote.fee))} />
              </dl>
            </div>
          )}

          <div className="mt-12">
            <button
              onClick={createOffRamp}
              disabled={!quote || orderLoading || quoteLoading}
              className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
            >
              {orderLoading && (
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
              )}
              {orderLoading ? 'Criando order…' : 'Criar order de saque'}
            </button>
          </div>
        </div>
      )}

      {step === 'signing' && offRamp && (
        <div className="mt-10">
          <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
            A Etherfuse preparou uma transação de <strong>burn</strong> que vai
            consumir o TESOURO da sua wallet. Em troca, a anchor inicia o PIX
            payout. Assine via Privy raw-hash.
          </p>
          <div className="mt-8 border-y border-base/15">
            <dl className="grid grid-cols-1 gap-px bg-base/10">
              <Cell k="Order" v={offRamp.orderId} />
              <Cell k="Status" v={`● ${offRamp.status}${offRamp.mock ? ' · mock' : ''}`} />
            </dl>
          </div>
          <button
            onClick={burnAndSubmit}
            disabled={burning}
            className="mt-12 bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
          >
            {burning && (
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
            )}
            {burning ? 'Assinando e submetendo…' : 'Assinar burn e submeter'}
          </button>
        </div>
      )}

      {(step === 'processing' || step === 'done') && offRamp && (
        <div className="mt-10">
          <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
            {step === 'done'
              ? 'Burn confirmado on-chain. Etherfuse moveu o off-ramp pra `processing`. Em produção, PIX cai na sua conta nos próximos minutos. Sandbox PIX/BRL não settla pra banco real (constraint upstream).'
              : 'Polling status da off-ramp a cada 3s. Etherfuse precisa indexar o burn (~10s).'}
          </p>
          <div className="mt-8 border-y border-base/15">
            <dl className="grid grid-cols-1 gap-px bg-base/10">
              {burnTxHash && (
                <Cell
                  k="Burn tx"
                  v={
                    <a
                      href={explorerTx(burnTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-base hover:text-primary-deep underline decoration-base/25 underline-offset-4 break-all"
                    >
                      {burnTxHash}
                    </a>
                  }
                />
              )}
              <Cell k="Order" v={offRamp.orderId} />
              <Cell k="Status" v={`● ${finalStatus?.status ?? offRamp.status}`} />
            </dl>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-10 px-5 py-4 bg-red-50 border border-red-200 text-red-900 font-mono text-[11px]"
        >
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">
            fechar
          </button>
        </div>
      )}
    </div>
  );
}

function Cell({
  k,
  v,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55">
        {k}
      </dt>
      <dd
        className={`mt-1 font-mono ${accent ? 'text-base text-lg font-semibold' : 'text-sm text-base/85'}`}
      >
        {v}
      </dd>
    </div>
  );
}
