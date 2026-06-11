'use client';

/**
 * Liquidar — venda reversa de PLINA-RF ao distributor a NAV corrente.
 *
 * Portado de /minha-posicao (absorvida pelo /painel): fluxo
 * cotar → assinar (Privy raw hash) → submeter on-chain → recibo com hashes.
 * Auto-contido: recebe o saldo e a wallet, e dispara onDone (re-fetch) ao
 * concluir. Nenhuma rota nova — usa /api/investidor/liquidar/{quote,build,submit}.
 */

import { usePrivy } from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { useCallback, useState } from 'react';
import { BRL, NUMBER_INT, explorerTx } from '../_lib/format';

interface LiquidarProps {
  stellarAddress: string;
  plinarfQty: number;
  onDone: () => void;
}

export default function Liquidar({
  stellarAddress,
  plinarfQty,
  onDone,
}: LiquidarProps) {
  const { getAccessToken } = usePrivy();
  const { signRawHash } = useSignRawHash();

  const [liqAmount, setLiqAmount] = useState('');
  const [liqQuote, setLiqQuote] = useState<{
    amountPlinarf: number;
    navPorTokenAtual: number;
    brlEquivalente: number;
  } | null>(null);
  const [liqStep, setLiqStep] = useState<
    'idle' | 'quoting' | 'ready' | 'signing' | 'submitting' | 'done'
  >('idle');
  const [liqResult, setLiqResult] = useState<{
    liquidationTxHash: string;
    auditTxHash: string;
    brlEquivalente: number;
    navPorTokenAtual: number;
  } | null>(null);
  const [liqError, setLiqError] = useState<string | null>(null);

  const fetchLiqQuote = useCallback(async () => {
    if (!liqAmount) return;
    setLiqError(null);
    setLiqStep('quoting');
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/liquidar/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amountPlinarf: liqAmount }),
      });
      if (!res.ok) throw new Error(await res.text());
      setLiqQuote(await res.json());
      setLiqStep('ready');
    } catch (err) {
      setLiqError(err instanceof Error ? err.message : String(err));
      setLiqStep('idle');
    }
  }, [liqAmount, getAccessToken]);

  const runLiquidate = useCallback(async () => {
    if (!stellarAddress || !liqAmount) return;
    setLiqError(null);
    setLiqStep('signing');
    try {
      const token = await getAccessToken();
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const buildRes = await fetch('/api/investidor/liquidar/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ pubkey: stellarAddress, amount: liqAmount }),
      });
      if (!buildRes.ok) throw new Error(await buildRes.text());
      const { xdr, hashHex } = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
      };

      const { signature } = await signRawHash({
        address: stellarAddress,
        chainType: 'stellar',
        hash: hashHex as `0x${string}`,
      });

      setLiqStep('submitting');
      const submitRes = await fetch('/api/investidor/liquidar/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          xdr,
          pubkey: stellarAddress,
          signatureHex: signature,
          amount: liqAmount,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      setLiqResult(await submitRes.json());
      setLiqStep('done');
      onDone();
    } catch (err) {
      setLiqError(err instanceof Error ? err.message : String(err));
      setLiqStep('ready');
    }
  }, [stellarAddress, liqAmount, signRawHash, onDone, getAccessToken]);

  function resetLiq() {
    setLiqAmount('');
    setLiqQuote(null);
    setLiqResult(null);
    setLiqStep('idle');
    setLiqError(null);
  }

  const busy = liqStep === 'signing' || liqStep === 'submitting';

  return (
    <div>
      <div className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/55 mb-3">
        Liquidar posição · venda reversa ao distributor
      </div>
      <div className="border border-light-hairline bg-lightBg">
        {liqStep !== 'done' ? (
          <div className="p-6 space-y-5">
            <p className="font-text text-sm text-base/70 max-w-2xl leading-relaxed">
              Vender PLINA-RF de volta ao distributor a NAV corrente. No POC, o
              BRL equivalente é simulado — em produção, a anchor desembolsa via
              PIX após a venda reversa on-chain. Whitepaper §6.4: janelas
              periódicas de liquidez.
            </p>

            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <label className="block flex-1">
                <span className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/70">
                  Quantidade PLINA-RF a liquidar
                </span>
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    min="1"
                    max={plinarfQty}
                    step="1"
                    value={liqAmount}
                    onChange={(e) => {
                      setLiqAmount(e.target.value);
                      setLiqQuote(null);
                      setLiqStep('idle');
                    }}
                    placeholder={`Máx. ${NUMBER_INT.format(plinarfQty)}`}
                    className="flex-1 bg-white border border-light-hairline px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={() => {
                      setLiqAmount(String(Math.floor(plinarfQty)));
                      setLiqQuote(null);
                      setLiqStep('idle');
                    }}
                    className="font-details text-[10px] font-bold tracking-[0.2em] uppercase border border-light-hairline px-3 hover:bg-base hover:text-lightBg transition-colors"
                  >
                    Máx
                  </button>
                </div>
              </label>
              <button
                onClick={fetchLiqQuote}
                disabled={
                  !liqAmount ||
                  Number(liqAmount) <= 0 ||
                  Number(liqAmount) > plinarfQty ||
                  liqStep === 'quoting'
                }
                className="bg-base text-lightBg font-details text-[10px] font-bold tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-40"
              >
                {liqStep === 'quoting' ? 'Calculando…' : 'Cotar liquidação'}
              </button>
            </div>

            {liqQuote && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 border border-light-hairline">
                <QuoteCell
                  label="Você entrega"
                  value={`${NUMBER_INT.format(liqQuote.amountPlinarf)} PLINARF`}
                />
                <QuoteCell
                  label="NAV / token"
                  value={BRL.format(liqQuote.navPorTokenAtual)}
                />
                <QuoteCell
                  label="BRL simulado"
                  value={BRL.format(liqQuote.brlEquivalente)}
                />
              </div>
            )}

            {liqQuote && (
              <div className="flex flex-wrap gap-3 pt-2 border-t border-light-hairline">
                <button
                  onClick={runLiquidate}
                  disabled={busy}
                  className="bg-base text-lightBg font-details text-[10px] font-bold tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
                >
                  {liqStep === 'signing'
                    ? 'Assinando via Privy…'
                    : liqStep === 'submitting'
                      ? 'Submetendo on-chain…'
                      : 'Confirmar liquidação'}
                </button>
                <button
                  onClick={resetLiq}
                  disabled={busy}
                  className="font-details text-[10px] font-bold tracking-[0.2em] uppercase border border-light-hairline px-4 py-3 hover:bg-base hover:text-lightBg transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            )}

            {liqError && (
              <p className="font-text text-sm text-red-700 border border-red-300 bg-red-50 p-3">
                ✗ {liqError}
              </p>
            )}
          </div>
        ) : liqResult ? (
          <div className="bg-base text-lightBg px-6 md:px-10 py-8 md:py-10">
            <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-primary">
              Liquidação confirmada
            </p>
            <p className="font-title text-3xl md:text-5xl font-semibold mt-3 tracking-tight">
              {BRL.format(liqResult.brlEquivalente)}{' '}
              <span className="font-mono text-xl md:text-2xl text-lightBg/70">
                BRL (simulado)
              </span>
            </p>
            <p className="font-text text-sm text-lightBg/70 mt-2 max-w-xl">
              PLINARF retornado ao distributor a NAV de{' '}
              <span className="font-mono">
                {BRL.format(liqResult.navPorTokenAtual)}
              </span>{' '}
              por token. Em produção, este passo dispara a TED/PIX da anchor pra
              conta do investidor.
            </p>
            <div className="mt-6 pt-6 border-t border-lightBg/10 space-y-1.5">
              <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-lightBg/50">
                Transações on-chain
              </p>
              <TxRowDark label="liquidação" hash={liqResult.liquidationTxHash} />
              <TxRowDark label="audit" hash={liqResult.auditTxHash} />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={resetLiq}
                className="bg-primary text-base font-details text-[10px] font-bold tracking-[0.2em] uppercase px-4 py-2 hover:bg-secondaryLight transition-colors"
              >
                Nova liquidação
              </button>
              <a
                href="/investir"
                className="border border-lightBg/30 text-lightBg font-details text-[10px] font-bold tracking-[0.2em] uppercase px-4 py-2 hover:bg-lightBg/10 transition-colors"
              >
                Comprar PLINA-RF
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuoteCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-lightBg px-5 py-6">
      <p className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      <p className="font-mono text-lg mt-2 text-base">{value}</p>
    </div>
  );
}

function TxRowDark({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <span className="font-details text-[10px] font-bold tracking-[0.2em] uppercase text-lightBg/50 min-w-[80px]">
        {label}
      </span>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] text-lightBg/85 hover:text-primary break-all"
      >
        {hash}
      </a>
    </div>
  );
}
