'use client';

/**
 * /investir — fluxo do investidor institucional.
 *
 * Cenas:
 *   1. Login Privy → ensure wallet → onboarding institucional (Etherfuse
 *      customer + KYC programático auto-aprovado em sandbox).
 *   2. Quote BRL → TESOURO (display real via Etherfuse API). Demo do POC
 *      simplifica o passo fiat→TESOURO (em produção via iframe Etherfuse +
 *      PIX TED), focando na cena que vende a tese: trustline + emissão
 *      assinadas via Privy modal.
 *   3. Trustline PLINARF assinada via useSignRawHash. Backend autoriza
 *      (issuer side) e distribui PLINARF (distributor side). Posição
 *      on-chain refletida via Horizon.
 *
 * Whitepaper §6.6 — fluxo do investidor institucional internacional.
 * ARCHITECTURE §3.5/§3.6 — fluxo real iframe-mediated documentado;
 * simplificação do demo registrada em comentários.
 */

import { usePrivy, useLogin, useLogout } from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { useCallback, useEffect, useState } from 'react';

interface OnboardData {
  investidorId: string;
  publicKey: string;
  etherfuseCustomerId: string;
  kycStatus: 'approved' | 'pending' | 'not_started';
  fundedNow: boolean;
}

interface QuoteData {
  quoteId: string;
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  fee: string;
  expiresAt: string;
}

interface BuyResult {
  trustlineTxHash: string;
  authorizeTxHash: string;
  distributeTxHash: string;
}

const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
function explorerAccount(pubkey: string) {
  return `https://stellar.expert/explorer/testnet/account/${pubkey}`;
}
function maskId(id: string): string {
  if (id.length < 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function InvestirPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { signRawHash } = useSignRawHash();

  const [step, setStep] = useState<'idle' | 'onboarding' | 'ready' | 'buying' | 'done'>(
    'idle',
  );
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  // Sandbox Etherfuse limita onramps a 500 MXN (≈ R$ 430). Sem default —
  // usuário escolhe o valor; auto-quote só dispara após digitar/escolher preset.
  const [amountBrl, setAmountBrl] = useState('');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [buyResult, setBuyResult] = useState<BuyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runOnboard = useCallback(async () => {
    setError(null);
    setStep('onboarding');
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
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`onboarding: ${t}`);
      }
      const data = (await res.json()) as OnboardData;
      setOnboard(data);
      setStep('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('idle');
    }
  }, [getAccessToken]);

  // Auto-onboard ao autenticar (idempotente, seguro de chamar várias vezes).
  useEffect(() => {
    if (ready && authenticated && step === 'idle' && !onboard) {
      runOnboard();
    }
  }, [ready, authenticated, step, onboard, runOnboard]);

  async function refreshQuote() {
    if (!onboard) return;
    const v = Number(amountBrl);
    if (!Number.isFinite(v) || v <= 0) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/investidor/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountBrl,
          customerId: onboard.etherfuseCustomerId,
          stellarAddress: onboard.publicKey,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setQuote((await res.json()) as QuoteData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuoteLoading(false);
    }
  }

  async function buy() {
    if (!onboard || !quote) return;
    setError(null);
    setStep('buying');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');

      // 1) build trustline XDR
      const buildRes = await fetch('/api/investidor/buy/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: onboard.publicKey }),
      });
      if (!buildRes.ok) throw new Error(await buildRes.text());
      const { xdr, hashHex } = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
      };

      // 2) Privy assina hash
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: hashHex as `0x${string}`,
      });

      // 3) submit (trustline + authorize + distribute)
      const submitRes = await fetch('/api/investidor/buy/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          xdr,
          investorPubkey: onboard.publicKey,
          signatureHex: signature,
          amount: quote.toAmount, // 1 PLINA-RF ≈ 1 BRL paridade POC
          investidorId: onboard.investidorId,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      setBuyResult((await submitRes.json()) as BuyResult);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('ready');
    }
  }

  if (!ready) {
    return <Loading text="Carregando Privy…" />;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="mb-10 border-b border-light-hairline pb-8">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Investir · PLINA-RF
        </p>
        <h1 className="font-title mt-3 text-3xl md:text-4xl font-semibold tracking-tight">
          Acesso institucional ao pool
        </h1>
        <p className="font-text mt-4 text-base/80 leading-relaxed">
          Onboarding institucional via wallet Stellar embedded (Privy) e
          anchor LATAM regulada (Etherfuse sandbox). KYC e quote BRL → TESOURO
          são chamadas reais à anchor; a cena fiat → TESOURO via PIX é
          simulada no POC para foco na assinatura on-chain. Em produção, o
          investidor completa o registro PIX no iframe da anchor antes do
          swap.
        </p>
      </header>

      {!authenticated ? (
        <button
          onClick={() => login()}
          className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
        >
          Entrar com email institucional
        </button>
      ) : (
        <div className="space-y-10">
          <Stepper
            steps={[
              { n: '01', label: 'Identidade', done: !!onboard, current: !onboard },
              {
                n: '02',
                label: 'Quote BRL → TESOURO',
                done: !!quote,
                current: !!onboard && !quote,
              },
              {
                n: '03',
                label: 'Comprar PLINA-RF',
                done: !!buyResult,
                current: !!onboard && !!quote && !buyResult,
              },
            ]}
          />
          <Section title="1. Identidade" status={onboard ? 'done' : 'pending'}>
            {onboard ? (
              <div className="space-y-2 text-sm">
                <Row k="Privy user id" v={user?.id} mono />
                <Row
                  k="Stellar address"
                  v={
                    <a
                      href={explorerAccount(onboard.publicKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs break-all underline"
                    >
                      {onboard.publicKey}
                    </a>
                  }
                />
                <Row
                  k="Etherfuse customer"
                  v={
                    <span
                      className="font-mono text-xs"
                      title={onboard.etherfuseCustomerId}
                    >
                      {maskId(onboard.etherfuseCustomerId)}
                    </span>
                  }
                />
                <Row
                  k="KYC"
                  v={
                    <Badge tone={onboard.kycStatus === 'approved' ? 'ok' : 'pending'}>
                      {onboard.kycStatus}
                    </Badge>
                  }
                />
                {onboard.fundedNow && (
                  <p className="font-text text-xs text-base/60">
                    Conta Stellar fundada via friendbot agora.
                  </p>
                )}
              </div>
            ) : step === 'onboarding' ? (
              <OnboardingSkeleton />
            ) : (
              <button
                onClick={runOnboard}
                className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-4 py-2"
              >
                Iniciar onboarding
              </button>
            )}
          </Section>

          {onboard && (
            <Section
              title="2. Quote BRL → TESOURO (anchor real)"
              status={quote ? 'done' : 'pending'}
            >
              <div className="flex flex-col md:flex-row md:items-end gap-3">
                <label className="block flex-1">
                  <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                    Valor BRL (sandbox: máx ≈ R$ 430)
                  </span>
                  <input
                    type="number"
                    min="10"
                    max="430"
                    step="10"
                    value={amountBrl}
                    onChange={(e) => setAmountBrl(e.target.value)}
                    className="mt-2 w-full bg-white border border-light-hairline px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <button
                  onClick={refreshQuote}
                  disabled={quoteLoading || !amountBrl}
                  className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-4 py-2 disabled:opacity-50"
                >
                  {quoteLoading ? 'Cotando…' : 'Obter quote'}
                </button>
              </div>

              {quote && (
                <div className="mt-4 grid grid-cols-2 gap-px bg-base/15 border border-light-hairline">
                  <Metric label="Você paga" value={BRL.format(Number(quote.fromAmount))} />
                  <Metric
                    label="TESOURO recebido"
                    value={NUMBER_BR.format(Number(quote.toAmount))}
                  />
                  <Metric
                    label="Taxa de câmbio"
                    value={NUMBER_BR.format(Number(quote.exchangeRate))}
                  />
                  <Metric label="Fee (BRL)" value={BRL.format(Number(quote.fee))} />
                </div>
              )}
              <p className="mt-3 font-text text-xs text-base/60">
                Quote ao vivo da Etherfuse sandbox. Em produção o investidor
                conclui o PIX neste ponto e a TED é processada pela anchor.
              </p>
            </Section>
          )}

          {onboard && quote && (
            <Section
              title="3. Comprar PLINA-RF"
              status={buyResult ? 'done' : 'pending'}
            >
              <p className="font-text text-sm text-base/80 mb-4">
                Você vai estabelecer trustline para PLINA-RF (1 assinatura via
                Privy) e receber{' '}
                <span className="font-mono">
                  {NUMBER_BR.format(Number(quote.toAmount))}
                </span>{' '}
                PLINA-RF na sua wallet. Paridade POC: 1 PLINA-RF = 1 BRL de NAV.
              </p>

              {!buyResult ? (
                <button
                  onClick={buy}
                  disabled={step === 'buying'}
                  className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
                >
                  {step === 'buying'
                    ? 'Trustline + autorização + distribuição…'
                    : 'Comprar PLINA-RF'}
                </button>
              ) : (
                <div className="bg-base text-lightBg -mx-4 md:-mx-8 -mb-4 md:-mb-8 px-6 md:px-10 py-8 md:py-10">
                  <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary">
                    Distribuição concluída
                  </p>
                  <p className="font-title text-3xl md:text-5xl font-semibold mt-3 tracking-tight">
                    {NUMBER_BR.format(Number(quote.toAmount))}{' '}
                    <span className="font-mono text-2xl md:text-3xl text-lightBg/70">
                      PLINA-RF
                    </span>
                  </p>
                  <p className="font-text text-sm text-lightBg/70 mt-2">
                    Na sua carteira Stellar institucional. Lastreado em
                    direito creditório brasileiro sob CVM 175.
                  </p>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <a
                      href="/minha-posicao"
                      className="bg-primary text-base font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-secondaryLight transition-colors"
                    >
                      Minha posição
                    </a>
                    <a
                      href={explorerAccount(onboard.publicKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border border-lightBg/30 text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-lightBg/10 transition-colors"
                    >
                      Stellar Expert →
                    </a>
                    <a
                      href="/pool"
                      className="border border-lightBg/30 text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-lightBg/10 transition-colors"
                    >
                      Pool atualizado
                    </a>
                    <button
                      onClick={() => {
                        setBuyResult(null);
                        setQuote(null);
                        setStep('ready');
                      }}
                      className="border border-lightBg/30 text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-4 py-2 hover:bg-lightBg/10 transition-colors"
                    >
                      Comprar mais
                    </button>
                  </div>

                  <div className="mt-6 pt-6 border-t border-lightBg/10 space-y-1.5">
                    <p className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50">
                      Transações on-chain
                    </p>
                    <TxRowDark label="trustline" hash={buyResult.trustlineTxHash} />
                    <TxRowDark label="authorize" hash={buyResult.authorizeTxHash} />
                    <TxRowDark label="distribute" hash={buyResult.distributeTxHash} />
                  </div>
                </div>
              )}
            </Section>
          )}

          {error && (
            <div className="border border-red-300 bg-red-50 text-red-800 p-4 text-sm font-text">
              ✗ {error}
            </div>
          )}

          <div className="pt-8 border-t border-light-hairline">
            <button
              onClick={() => logout()}
              className="font-details text-[10px] tracking-[0.2em] uppercase underline"
            >
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  status,
  children,
}: {
  title: string;
  status: 'pending' | 'done';
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Badge tone={status === 'done' ? 'ok' : 'neutral'}>
          {status === 'done' ? 'concluído' : 'aguardando'}
        </Badge>
        <h2 className="font-title text-xl font-semibold tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Row({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 min-w-[140px]">
        {k}
      </span>
      <span className={mono ? 'font-mono text-xs' : 'text-sm'}>{v}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-lightBg px-4 py-3">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      <p className="font-mono text-base mt-1">{value}</p>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'pending' | 'neutral';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-primary text-white'
      : tone === 'pending'
        ? 'bg-yellow-100 text-yellow-900'
        : 'bg-base/10 text-base/70';
  return (
    <span
      className={`inline-block font-details text-[10px] tracking-[0.15em] uppercase px-2 py-1 ${cls}`}
    >
      {children}
    </span>
  );
}

function TxRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 min-w-[80px]">
        {label}
      </span>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="underline break-all"
      >
        {hash}
      </a>
    </div>
  );
}

function TxRowDark({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-lightBg/50 min-w-[80px]">
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

function Loading({ text }: { text: string }) {
  return (
    <p className="font-text text-sm text-base/70 animate-pulse">{text}</p>
  );
}

function OnboardingSkeleton() {
  const phases = [
    'Criando wallet Stellar embedded',
    'Criando customer institucional na anchor',
    'Submetendo KYC programático',
    'Confirmando aprovação',
  ];
  return (
    <div className="space-y-3">
      {phases.map((p, idx) => (
        <div key={p} className="flex items-center gap-3">
          <span
            className="font-mono text-xs text-base/40 animate-pulse"
            style={{ animationDelay: `${idx * 200}ms` }}
          >
            {String(idx + 1).padStart(2, '0')}
          </span>
          <span className="font-text text-sm text-base/70">{p}…</span>
          <span
            className="h-px flex-1 bg-base/15 animate-pulse"
            style={{ animationDelay: `${idx * 200 + 100}ms` }}
          />
        </div>
      ))}
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/50 pt-2">
        Sandbox auto-aprova · ~3-8 segundos
      </p>
    </div>
  );
}

interface Step {
  n: string;
  label: string;
  done: boolean;
  current: boolean;
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="border-y border-light-hairline divide-y md:divide-y-0 md:divide-x divide-light-hairline grid grid-cols-1 md:grid-cols-3">
      {steps.map((s) => (
        <li key={s.n} className="relative px-5 py-5 group">
          <span
            className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              s.current
                ? 'scale-y-100 bg-primary'
                : s.done
                  ? 'scale-y-100 bg-base/30'
                  : 'scale-y-0 bg-base/15'
            }`}
          />
          <p
            className={`font-mono text-xs ${
              s.done ? 'text-primary-deep' : s.current ? 'text-base' : 'text-base/30'
            }`}
          >
            {s.n} {s.done ? '✓' : ''}
          </p>
          <p
            className={`font-title text-base font-semibold mt-1 tracking-tight ${
              s.current ? 'text-base' : s.done ? 'text-base/80' : 'text-base/40'
            }`}
          >
            {s.label}
          </p>
        </li>
      ))}
    </ol>
  );
}
