'use client';

/**
 * /investir — fluxo do investidor institucional.
 *
 * 5 telas guiadas: welcome → identity → quote → confirm → receipt.
 * Disciplina Regulated Terminal (DESIGN.md). Pensado pra mesa de risco
 * institucional: glossário inline, preview de XDR, confirmação dupla,
 * banner persistente de testnet, error recovery com ticket ID.
 *
 * Whitepaper §6.6. ARCHITECTURE §3.5/§3.6.
 */

import {
  usePrivy,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLogout,
} from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Screen =
  | 'welcome'
  | 'identity'
  | 'quote'
  | 'onramp'
  | 'settling'
  | 'confirm'
  | 'receipt';

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

interface PixInstructions {
  type?: string;
  pixCode?: string;
  pixKey?: string;
  pixKeyType?: string;
  beneficiary?: string;
  amount?: string;
  currency?: string;
  __mock?: boolean;
}

interface OnRampData {
  orderId: string;
  status: string;
  paymentInstructions: PixInstructions | null;
  mock: boolean;
  stellarTxHash?: string | null;
}

interface SwapEnvelope {
  xdr: string;
  hashHex: string;
  distributorSigBase64: string;
  distributorPubkey: string;
  mock: false;
}

interface SwapMockResult {
  txHash: string;
  mock: true;
  alreadyExecuted: true;
}

type SwapBuild = SwapEnvelope | SwapMockResult;

interface BuyResult {
  swapTxHash: string;
  onRampTxHash: string | null;
  mock: boolean;
}

interface FlowError {
  message: string;
  technical: string;
  ticketId: string;
}

const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'welcome', label: 'Acesso' },
  { id: 'identity', label: 'Identidade' },
  { id: 'quote', label: 'Cotação' },
  { id: 'onramp', label: 'Pagamento' },
  { id: 'settling', label: 'Liquidação' },
  { id: 'confirm', label: 'Revisão' },
  { id: 'receipt', label: 'Confirmação' },
];

const QUOTE_PRESETS = ['100', '250', '430'];
const QUOTE_TTL_MS = 60_000;

const GLOSSARY: Record<string, string> = {
  trustline:
    'Autorização do investidor pra receber um asset emitido por outra conta Stellar. Sem trustline, a wallet não aceita o token.',
  authorize:
    'Operação do issuer que libera a trustline pra movimentação. PLINA-RF tem AUTH_REQUIRED, exigindo authorize explícito.',
  distribute:
    'Pagamento do distributor pra wallet do investidor. Após authorize, o issuer libera; o distributor paga.',
  TESOURO:
    'Token Stellar emitido pela Etherfuse representando Tesouro Direto brasileiro. Bridge intermediário entre BRL e PLINA-RF no fluxo de produção.',
  'paridade NAV':
    'Razão 1:1 entre PLINA-RF e o valor patrimonial líquido (NAV) do FIDC. No POC, mantida sem revalorização; em produção, NAV é apurado diariamente.',
  clawback:
    'AUTH_CLAWBACK_ENABLED. Permite o issuer revogar tokens em hipóteses limitadas (judicial, sanção, fraude, erro). Diferencial institucional documentado no whitepaper §6.5.',
  'swap atômico':
    'Envelope Stellar com 2 operações no mesmo tx: investor paga TESOURO ao distributor + distributor paga PLINA-RF ao investor. Ambas legs commitam juntas — sem TESOURO, sem PLINA-RF. Substitui o single-shot do MVP por settlement on-chain real.',
  onramp:
    'BRL → TESOURO via Etherfuse. Investidor paga PIX off-chain, Etherfuse paga TESOURO na wallet Stellar. Pré-condição pro swap PLINA-RF.',
};

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
function maskPubkey(pk: string): string {
  if (pk.length < 16) return pk;
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`;
}

function newTicketId(): string {
  return `INC-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function humanizeError(raw: string): { message: string; technical: string } {
  const t = raw.toLowerCase();
  if (t.includes('etherfuse') && t.includes('limit')) {
    return {
      message: 'Limite do sandbox Etherfuse atingido. Em produção, o tíquete é definido pelo seu compromisso institucional.',
      technical: raw,
    };
  }
  if (t.includes('etherfuse')) {
    return { message: 'Falha na consulta à anchor Etherfuse. Tente novamente em alguns segundos.', technical: raw };
  }
  if (t.includes('token privy') || t.includes('jws') || t.includes('sessão privy')) {
    return { message: 'Sessão expirou. Faça login novamente para continuar.', technical: raw };
  }
  if (t.includes('horizon') || t.includes('stellar')) {
    return { message: 'Falha de comunicação com a rede Stellar. A operação não foi consumada.', technical: raw };
  }
  if (t.includes('pubkey') || t.includes('public key')) {
    return { message: 'Endereço Stellar inválido. Recarregue a página para regenerar a wallet.', technical: raw };
  }
  return { message: 'Operação não concluída. Reporte o incidente abaixo se persistir.', technical: raw };
}

function asFlowError(err: unknown): FlowError {
  const raw = err instanceof Error ? err.message : String(err);
  const { message, technical } = humanizeError(raw);
  return { message, technical, ticketId: newTicketId() };
}

export default function InvestirPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { logout } = useLogout();
  const { signRawHash } = useSignRawHash();
  const emailLogin = useLoginWithEmail();
  const oauthLogin = useLoginWithOAuth();

  const [screen, setScreen] = useState<Screen>('welcome');
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [kycConsented, setKycConsented] = useState(false);
  const [trustlinesReady, setTrustlinesReady] = useState(false);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const [amountBrl, setAmountBrl] = useState('');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [onRamp, setOnRamp] = useState<OnRampData | null>(null);
  const [onRampLoading, setOnRampLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [swapBuild, setSwapBuild] = useState<SwapBuild | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [signConfirmed, setSignConfirmed] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyResult, setBuyResult] = useState<BuyResult | null>(null);
  const [error, setError] = useState<FlowError | null>(null);

  const runOnboard = useCallback(async () => {
    setError(null);
    setOnboarding(true);
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
      if (!res.ok) throw new Error(`onboarding: ${await res.text()}`);
      setOnboard((await res.json()) as OnboardData);
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setOnboarding(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (ready && authenticated && screen === 'welcome') {
      setScreen('identity');
    }
  }, [ready, authenticated, screen]);

  const refreshQuote = useCallback(async () => {
    if (!onboard) return;
    const v = Number(amountBrl);
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
          amountBrl,
          customerId: onboard.etherfuseCustomerId,
          stellarAddress: onboard.publicKey,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setQuote((await res.json()) as QuoteData);
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setQuoteLoading(false);
    }
  }, [onboard, amountBrl, getAccessToken]);

  useEffect(() => {
    if (screen !== 'quote' || !onboard) return;
    const t = setTimeout(() => {
      void refreshQuote();
    }, 600);
    return () => clearTimeout(t);
  }, [amountBrl, screen, onboard, refreshQuote]);

  // Trustline setup (PLINARF + TESOURO). Roda automaticamente quando o
  // investor entra no screen identity já onboardado. Idempotente: se
  // trustlinesReady=true, pula. PLINARF é pré-condição pra receber emissão;
  // TESOURO é pré-condição pra leg investor→distributor do swap atômico.
  const setupTrustlines = useCallback(async () => {
    if (!onboard || trustlinesReady || trustlineLoading) return;
    setTrustlineLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      // PLINARF trustline.
      const plinarfBuild = await fetch(
        '/api/investidor/buy/trust-plinarf/build',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ pubkey: onboard.publicKey }),
        },
      );
      if (!plinarfBuild.ok) throw new Error(await plinarfBuild.text());
      const plinarfBuildData = (await plinarfBuild.json()) as {
        xdr: string;
        hashHex: string;
      };
      const plinarfSig = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: plinarfBuildData.hashHex as `0x${string}`,
      });
      const plinarfSubmit = await fetch(
        '/api/investidor/buy/trust-plinarf/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            xdr: plinarfBuildData.xdr,
            investorPubkey: onboard.publicKey,
            signatureHex: plinarfSig.signature,
          }),
        },
      );
      if (!plinarfSubmit.ok) throw new Error(await plinarfSubmit.text());

      // TESOURO trustline (bridge da Etherfuse).
      const tesouroBuild = await fetch(
        '/api/investidor/buy/trust-tesouro/build',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ pubkey: onboard.publicKey }),
        },
      );
      if (!tesouroBuild.ok) throw new Error(await tesouroBuild.text());
      const tesouroBuildData = (await tesouroBuild.json()) as {
        xdr: string;
        hashHex: string;
      };
      const tesouroSig = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: tesouroBuildData.hashHex as `0x${string}`,
      });
      const tesouroSubmit = await fetch(
        '/api/investidor/buy/trust-tesouro/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            xdr: tesouroBuildData.xdr,
            investorPubkey: onboard.publicKey,
            signatureHex: tesouroSig.signature,
          }),
        },
      );
      if (!tesouroSubmit.ok) throw new Error(await tesouroSubmit.text());

      setTrustlinesReady(true);
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setTrustlineLoading(false);
    }
  }, [onboard, signRawHash, trustlinesReady, trustlineLoading, getAccessToken]);

  // Cria onramp Etherfuse + transita pra screen de pagamento PIX.
  const goToOnramp = useCallback(async () => {
    if (!quote) return;
    setOnRampLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/onramp/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as OnRampData;
      setOnRamp(data);
      setScreen('onramp');
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setOnRampLoading(false);
    }
  }, [quote, getAccessToken]);

  // Sandbox-only: dispara simulação de PIX pago. Após resolver, vai pro
  // settling screen que vai pollar até completed.
  const sandboxPay = useCallback(async () => {
    if (!onRamp) return;
    setPaying(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/onramp/sandbox-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId: onRamp.orderId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        status: string;
        stellarTxHash: string | null;
        mock: boolean;
      };
      setOnRamp({ ...onRamp, ...data });
      setScreen('settling');
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setPaying(false);
    }
  }, [onRamp, getAccessToken]);

  // Polling do status da onramp no settling screen — para quando completed.
  useEffect(() => {
    if (screen !== 'settling' || !onRamp || onRamp.status === 'completed') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `/api/investidor/buy/onramp/status?orderId=${encodeURIComponent(onRamp.orderId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          stellarTxHash: string | null;
          mock: boolean;
        };
        if (cancelled) return;
        setOnRamp((prev) => (prev ? { ...prev, ...data } : prev));
      } catch {
        // ignora — próximo tick retenta
      }
    };
    void tick();
    const id = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [screen, onRamp, getAccessToken]);

  // Build swap envelope (real) ou executa swap direto (mock).
  const goToConfirm = useCallback(async () => {
    if (!onboard || !quote || !onRamp || onRamp.status !== 'completed') return;
    setSwapLoading(true);
    setError(null);
    setSignConfirmed(false);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/investidor/buy/swap/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          investorPubkey: onboard.publicKey,
          investidorId: onboard.investidorId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SwapBuild;
      setSwapBuild(data);
      if (data.mock) {
        // Mock: server já executou. Vai direto pro receipt.
        setBuyResult({
          swapTxHash: data.txHash,
          onRampTxHash: onRamp.stellarTxHash ?? null,
          mock: true,
        });
        setScreen('receipt');
      } else {
        setScreen('confirm');
      }
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setSwapLoading(false);
    }
  }, [onboard, quote, onRamp, getAccessToken]);

  async function buy() {
    if (!onboard || !quote || !swapBuild || swapBuild.mock) return;
    setError(null);
    setBuying(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão Privy expirada.');
      const { signature } = await signRawHash({
        address: onboard.publicKey,
        chainType: 'stellar',
        hash: swapBuild.hashHex as `0x${string}`,
      });
      const submitRes = await fetch('/api/investidor/buy/swap/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          investorPubkey: onboard.publicKey,
          signatureHex: signature,
          xdr: swapBuild.xdr,
          distributorSigBase64: swapBuild.distributorSigBase64,
          distributorPubkey: swapBuild.distributorPubkey,
          investidorId: onboard.investidorId,
        }),
      });
      if (!submitRes.ok) throw new Error(await submitRes.text());
      const data = (await submitRes.json()) as { swapTxHash: string };
      setBuyResult({
        swapTxHash: data.swapTxHash,
        onRampTxHash: onRamp?.stellarTxHash ?? null,
        mock: false,
      });
      setScreen('receipt');
    } catch (err) {
      setError(asFlowError(err));
    } finally {
      setBuying(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando Privy…
        </p>
      </div>
    );
  }

  const currentIdx = SCREENS.findIndex((s) => s.id === screen);
  const canGoBack = authenticated && screen !== 'welcome' && screen !== 'receipt';

  function goBack() {
    const prev = SCREENS[Math.max(0, currentIdx - 1)];
    if (prev) setScreen(prev.id);
  }

  return (
    <div className="bg-lightBg min-h-screen">
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-[260px_1fr] md:gap-px md:bg-base/10">
        <aside className="hidden md:block bg-lightBg sticky top-0 self-start h-screen">
          <Rail current={screen} onboard={!!onboard} quote={!!quote} buyResult={!!buyResult} />
        </aside>

        <div className="md:hidden bg-lightBg border-b border-light-hairline px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-primary-deep">
              {String(currentIdx + 1).padStart(2, '0')} / {String(SCREENS.length).padStart(2, '0')}
            </span>
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
              {SCREENS[currentIdx]?.label}
            </span>
          </div>
          {authenticated && (
            <button
              onClick={() => logout()}
              className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base"
            >
              Sair
            </button>
          )}
        </div>

        <main className="bg-white min-h-screen relative">
          <div className="px-6 py-12 md:px-16 md:py-20 max-w-2xl">
            {canGoBack && (
              <button
                onClick={goBack}
                className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base mb-10 transition-colors"
              >
                ← Voltar
              </button>
            )}

            <ScreenFader key={screen}>
              {screen === 'welcome' && (
                <WelcomeScreen emailLogin={emailLogin} oauthLogin={oauthLogin} />
              )}
              {screen === 'identity' && (
                <IdentityScreen
                  onboard={onboard}
                  onboarding={onboarding}
                  consented={kycConsented}
                  onConsent={() => {
                    setKycConsented(true);
                    void runOnboard();
                  }}
                  user={user}
                  trustlinesReady={trustlinesReady}
                  trustlineLoading={trustlineLoading}
                  onSetupTrustlines={setupTrustlines}
                  onContinue={() => setScreen('quote')}
                  onRetry={runOnboard}
                />
              )}
              {screen === 'quote' && onboard && (
                <QuoteScreen
                  amountBrl={amountBrl}
                  setAmountBrl={setAmountBrl}
                  quote={quote}
                  loading={quoteLoading}
                  buildLoading={onRampLoading}
                  onContinue={goToOnramp}
                />
              )}
              {screen === 'onramp' && onboard && quote && onRamp && (
                <OnRampScreen
                  onRamp={onRamp}
                  quote={quote}
                  paying={paying}
                  onSandboxPay={sandboxPay}
                  onSkipToSettling={() => setScreen('settling')}
                />
              )}
              {screen === 'settling' && onboard && quote && onRamp && (
                <SettlingScreen
                  onRamp={onRamp}
                  quote={quote}
                  swapLoading={swapLoading}
                  onContinue={goToConfirm}
                />
              )}
              {screen === 'confirm' && onboard && quote && swapBuild && !swapBuild.mock && (
                <ConfirmScreen
                  onboard={onboard}
                  quote={quote}
                  swap={swapBuild}
                  signConfirmed={signConfirmed}
                  setSignConfirmed={setSignConfirmed}
                  buying={buying}
                  onConfirm={buy}
                />
              )}
              {screen === 'receipt' && onboard && quote && buyResult && (
                <ReceiptScreen
                  onboard={onboard}
                  quote={quote}
                  buyResult={buyResult}
                  onBuyMore={() => {
                    setBuyResult(null);
                    setSwapBuild(null);
                    setOnRamp(null);
                    setQuote(null);
                    setSignConfirmed(false);
                    setScreen('quote');
                  }}
                />
              )}
            </ScreenFader>

            {error && <ErrorBlock error={error} onDismiss={() => setError(null)} />}

            {authenticated && screen !== 'receipt' && (
              <div className="hidden md:block mt-20 pt-8 border-t border-light-hairline">
                <button
                  onClick={() => logout()}
                  className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 hover:text-base transition-colors"
                >
                  Sair da sessão
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

function Rail({
  current,
  onboard,
  quote,
  buyResult,
}: {
  current: Screen;
  onboard: boolean;
  quote: boolean;
  buyResult: boolean;
}) {
  const done: Record<Screen, boolean> = {
    welcome: current !== 'welcome',
    identity: onboard && current !== 'identity',
    quote: quote && current !== 'quote' && current !== 'identity',
    onramp: current === 'settling' || current === 'confirm' || current === 'receipt',
    settling: current === 'confirm' || current === 'receipt',
    confirm: buyResult,
    receipt: false,
  };

  return (
    <div className="px-8 py-12 h-full flex flex-col">
      <div className="mb-12">
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          Investir · PLINA-RF
        </p>
        <p className="font-title text-lg font-semibold mt-3 tracking-tight leading-tight text-base">
          Acesso institucional ao pool
        </p>
      </div>

      <ol className="space-y-px bg-base/10 -mx-8">
        {SCREENS.map((s, idx) => {
          const isCurrent = s.id === current;
          const isDone = done[s.id];
          return (
            <li
              key={s.id}
              className={`relative bg-lightBg px-8 py-5 transition-colors duration-300 ${
                isCurrent ? 'bg-white' : ''
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isCurrent
                    ? 'scale-y-100 bg-primary'
                    : isDone
                      ? 'scale-y-100 bg-base/25'
                      : 'scale-y-0 bg-base/15'
                }`}
              />
              <div className="flex items-baseline gap-4">
                <span
                  className={`font-mono text-xs transition-colors ${
                    isDone ? 'text-primary-deep' : isCurrent ? 'text-base' : 'text-base/35'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span
                  className={`font-details text-[11px] tracking-[0.2em] uppercase transition-colors ${
                    isCurrent
                      ? 'text-base'
                      : isDone
                        ? 'text-base/70'
                        : 'text-base/40'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto pt-12">
        <p className="font-mono text-[10px] text-base/55 leading-relaxed">
          CVM 175 · FIDC<br />
          Stellar testnet · Etherfuse sandbox
        </p>
      </div>
    </div>
  );
}

function ScreenFader({ children }: { children: React.ReactNode }) {
  return <div className="animate-screen-in">{children}</div>;
}

function TestnetBanner() {
  return (
    <div
      role="note"
      className="mb-8 bg-lightBg border-y border-base/15 px-5 py-3 flex items-center gap-3"
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-primary-deep flex-shrink-0"
        aria-hidden
      />
      <p className="font-details text-[10px] tracking-[0.25em] uppercase text-base">
        Stellar testnet · não é mainnet · sem valor financeiro real
      </p>
    </div>
  );
}

function Term({ children }: { children: keyof typeof GLOSSARY | string }) {
  const key = typeof children === 'string' ? children : (children as string);
  const def = GLOSSARY[key];
  if (!def) return <>{children}</>;
  return (
    <abbr
      title={def}
      className="cursor-help no-underline border-b border-dotted border-primary-deep/60 hover:border-primary-deep transition-colors"
    >
      {children}
    </abbr>
  );
}

function ErrorBlock({ error, onDismiss }: { error: FlowError; onDismiss: () => void }) {
  const [showTech, setShowTech] = useState(false);
  return (
    <div
      role="alert"
      className="mt-10 bg-white border border-base/20"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-light-hairline">
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-deep" aria-hidden />
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
            Operação interrompida
          </p>
        </div>
        <span className="font-mono text-[10px] text-base/55 tracking-wide">
          {error.ticketId}
        </span>
      </div>
      <p className="font-text text-sm text-base/85 leading-relaxed px-5 py-5">
        {error.message}
      </p>
      <div className="border-t border-light-hairline px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <button
          onClick={() => setShowTech((v) => !v)}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base"
        >
          {showTech ? '— Detalhes técnicos' : '+ Detalhes técnicos'}
        </button>
        <a
          href={`mailto:contato@plina.finance?subject=Incidente%20${encodeURIComponent(error.ticketId)}&body=${encodeURIComponent(`Ticket: ${error.ticketId}\n\nMensagem técnica:\n${error.technical}`)}`}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep hover:text-base"
        >
          Reportar incidente →
        </a>
        <button
          onClick={onDismiss}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base ml-auto"
        >
          Dispensar
        </button>
      </div>
      {showTech && (
        <pre className="bg-lightBg/60 border-t border-light-hairline px-5 py-4 font-mono text-[10px] text-base/70 whitespace-pre-wrap break-all">
          {error.technical}
        </pre>
      )}
    </div>
  );
}

/* ---------- screens ---------- */

function WelcomeScreen({
  emailLogin,
  oauthLogin,
}: {
  emailLogin: ReturnType<typeof useLoginWithEmail>;
  oauthLogin: ReturnType<typeof useLoginWithOAuth>;
}) {
  const { sendCode, loginWithCode, state } = emailLogin;
  const { initOAuth, loading: oauthLoading } = oauthLogin;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const sending = state.status === 'sending-code';
  const verifying = state.status === 'submitting-code';
  const awaitingCode = state.status === 'awaiting-code-input' || verifying;
  const flowError = state.status === 'error' ? state.error?.message ?? null : null;
  const oauthError =
    oauthLogin.state.status === 'error' ? oauthLogin.state.error?.message ?? null : null;
  const error = localError ?? flowError ?? oauthError;

  useEffect(() => {
    if (state.status === 'awaiting-code-input') codeInputRef.current?.focus();
  }, [state.status]);

  async function onGoogle() {
    setLocalError(null);
    try {
      await initOAuth({ provider: 'google' });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Falha no login Google.');
    }
  }

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError('Email inválido.');
      return;
    }
    try {
      await sendCode({ email });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Falha ao enviar código.');
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (code.length < 6) {
      setLocalError('Código incompleto.');
      return;
    }
    try {
      await loginWithCode({ code });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Código inválido.');
    }
  }

  async function onResend() {
    setLocalError(null);
    setCode('');
    try {
      await sendCode({ email });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Falha ao reenviar.');
    }
  }

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        01 // Acesso · PLINA-RF
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold mt-4 tracking-tight leading-[1.05] text-base">
        Acesso institucional ao pool de direitos creditórios.
      </h1>
      <p className="font-text text-base mt-6 text-base/80 leading-relaxed max-w-prose">
        Onboarding via wallet Stellar embedded e anchor LATAM regulada.
        KYC institucional, quote BRL → PLINA-RF ao vivo e <Term>trustline</Term> assinada por você.
      </p>

      <div className="mt-12">
        {!awaitingCode && (
          <div className="mb-8">
            <button
              type="button"
              onClick={onGoogle}
              disabled={oauthLoading || sending}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 border border-base/20 bg-white text-base font-details text-xs tracking-[0.2em] uppercase px-6 py-4 rounded-full hover:border-base hover:bg-lightBg/40 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GoogleMark />
              {oauthLoading ? 'Redirecionando…' : 'Continuar com Google'}
            </button>

            <div className="flex items-center gap-4 mt-8" aria-hidden>
              <span className="h-px flex-1 bg-base/15" />
              <span className="font-details text-[10px] tracking-[0.3em] uppercase text-base/55">
                ou
              </span>
              <span className="h-px flex-1 bg-base/15" />
            </div>
          </div>
        )}

        {!awaitingCode ? (
          <form onSubmit={onSendCode} className="space-y-6">
            <label className="block">
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                Email institucional
              </span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="voce@familyoffice.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                className="mt-3 block w-full bg-transparent border-b border-base/30 focus:border-base font-mono text-xl md:text-2xl text-base placeholder:text-base/30 py-3 focus:outline-none transition-colors disabled:opacity-50"
              />
            </label>

            <div>
              <button
                type="submit"
                disabled={sending || !email}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
              >
                {sending && (
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
                )}
                {sending ? 'Enviando código…' : 'Enviar código de acesso'}
              </button>
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-4">
                Privy · embedded wallet Stellar · sem extensão
              </p>
            </div>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-6">
            <div>
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                Código enviado para
              </span>
              <p className="font-mono text-sm text-base mt-2">{email}</p>
            </div>

            <label className="block">
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
                Código de 6 dígitos
              </span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                required
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={verifying}
                className="mt-3 block w-full bg-transparent border-b border-base/30 focus:border-base font-mono text-3xl md:text-4xl text-base placeholder:text-base/25 tracking-[0.4em] py-3 focus:outline-none transition-colors disabled:opacity-50"
              />
            </label>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                type="submit"
                disabled={verifying || code.length < 6}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
              >
                {verifying && (
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
                )}
                {verifying ? 'Verificando…' : 'Entrar'}
              </button>
              <button
                type="button"
                onClick={onResend}
                disabled={sending || verifying}
                className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors disabled:opacity-40"
              >
                {sending ? 'Reenviando…' : 'Reenviar código'}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div role="alert" className="mt-6 border border-base/15 bg-white px-4 py-3">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Erro
            </p>
            <p className="font-mono text-xs mt-1 text-base">{error}</p>
          </div>
        )}
      </div>

      <dl className="mt-16 pt-10 border-t border-light-hairline grid grid-cols-1 sm:grid-cols-3 gap-px bg-base/10">
        {[
          { k: 'Token', v: 'PLINA-RF' },
          { k: 'Lastro', v: 'FIDC / CVM 175' },
          { k: 'Rede', v: 'Stellar' },
        ].map((it) => (
          <div key={it.k} className="bg-white px-5 py-5">
            <dt className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
              {it.k}
            </dt>
            <dd className="font-mono text-sm mt-2 text-base">{it.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function IdentityScreen({
  onboard,
  onboarding,
  consented,
  onConsent,
  user,
  trustlinesReady,
  trustlineLoading,
  onSetupTrustlines,
  onContinue,
  onRetry,
}: {
  onboard: OnboardData | null;
  onboarding: boolean;
  consented: boolean;
  onConsent: () => void;
  user: ReturnType<typeof usePrivy>['user'];
  trustlinesReady: boolean;
  trustlineLoading: boolean;
  onSetupTrustlines: () => void;
  onContinue: () => void;
  onRetry: () => void;
}) {
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        02 // Identidade · KYC institucional
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Wallet Stellar e KYC programático.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        A Plina cria sua wallet Stellar embedded e registra o investidor na
        anchor regulada Etherfuse. KYC auto-aprovado no sandbox.
      </p>

      <div className="mt-12">
        {!consented && !onboard && (
          <div>
            <div className="bg-white border border-base/15 px-6 py-6">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 mb-3">
                Sessão Privy autenticada
              </p>
              <p className="font-text text-sm text-base/80 leading-relaxed">
                Ao continuar, você consente com a criação da wallet Stellar
                embedded, registro do customer na Etherfuse e submissão de
                KYC programático no ambiente de sandbox. Nenhum dado real
                é coletado nesta etapa.
              </p>
            </div>
            <div className="mt-8">
              <button
                onClick={onConsent}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200"
              >
                Iniciar onboarding
              </button>
            </div>
          </div>
        )}

        {(onboarding || (consented && !onboard)) && <OnboardingProgress />}

        {consented && !onboarding && !onboard && (
          <button
            onClick={onRetry}
            className="mt-6 bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-6 py-3 rounded-full hover:bg-primary-deep transition-colors duration-200"
          >
            Tentar novamente
          </button>
        )}

        {onboard && (
          <>
            <dl className="grid grid-cols-1 gap-px bg-base/10 border-y border-light-hairline">
              <DataRow k="Privy user" v={user?.id ?? '—'} mono />
              <DataRow
                k="Stellar address"
                v={
                  <a
                    href={explorerAccount(onboard.publicKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-base hover:text-primary-deep underline decoration-base/25 underline-offset-4 break-all"
                  >
                    {onboard.publicKey}
                  </a>
                }
              />
              <DataRow
                k="Etherfuse customer"
                v={<span className="font-mono text-xs">{maskId(onboard.etherfuseCustomerId)}</span>}
              />
              <DataRow
                k="KYC status"
                v={
                  <span
                    className={`font-details text-[10px] tracking-[0.2em] uppercase ${
                      onboard.kycStatus === 'approved' ? 'text-primary-deep' : 'text-base/70'
                    }`}
                  >
                    {onboard.kycStatus === 'approved' ? '● aprovado' : `○ ${onboard.kycStatus}`}
                  </span>
                }
              />
              {onboard.fundedNow && (
                <DataRow
                  k="Funding"
                  v={
                    <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
                      friendbot · agora
                    </span>
                  }
                />
              )}
            </dl>

            <div className="mt-10 border-y border-light-hairline py-6">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mb-3">
                Trustlines · setup one-time
              </p>
              <p className="font-text text-sm text-base/80 leading-relaxed">
                Pra operar o swap atômico (whitepaper §6.6), sua wallet precisa
                de duas trustlines: <Term>TESOURO</Term> (bridge da anchor) e
                PLINA-RF. Você assina os dois <Term>trustline</Term> hashes via
                Privy uma única vez.
              </p>
              {trustlinesReady ? (
                <p className="mt-4 font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
                  ● trustlines configuradas
                </p>
              ) : (
                <button
                  onClick={onSetupTrustlines}
                  disabled={trustlineLoading}
                  className="mt-4 bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-6 py-3 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-3"
                >
                  {trustlineLoading && (
                    <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
                  )}
                  {trustlineLoading
                    ? 'Aguardando assinatura Privy…'
                    : 'Configurar trustlines (2 assinaturas)'}
                </button>
              )}
            </div>

            <div className="mt-12">
              <button
                onClick={onContinue}
                disabled={!trustlinesReady}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continuar para cotação
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuoteScreen({
  amountBrl,
  setAmountBrl,
  quote,
  loading,
  buildLoading,
  onContinue,
}: {
  amountBrl: string;
  setAmountBrl: (v: string) => void;
  quote: QuoteData | null;
  loading: boolean;
  buildLoading: boolean;
  onContinue: () => void;
}) {
  const expiresIn = useExpiresIn(quote?.expiresAt);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        03 // Cotação · BRL → PLINA-RF
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Quote ao vivo na anchor regulada.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Consulta real à Etherfuse. No POC, paridade 1:1 entre <Term>TESOURO</Term>{' '}
        (bridge intermediário) e PLINA-RF. Em produção, o PIX é concluído
        neste passo via iframe da anchor.
      </p>

      <div className="mt-12">
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Valor BRL
          </span>
          <div className="mt-3 flex items-baseline gap-4 border-b border-base pb-3">
            <span className="font-mono text-2xl text-base/45">R$</span>
            <input
              type="number"
              min="10"
              max="430"
              step="10"
              value={amountBrl}
              onChange={(e) => setAmountBrl(e.target.value)}
              className="flex-1 bg-transparent font-mono text-4xl md:text-5xl text-base font-medium focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Valor em reais"
            />
            {loading && (
              <span
                className="w-1.5 h-1.5 bg-primary-deep rounded-full animate-pulse"
                aria-label="Atualizando quote"
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-base/55 mt-2 inline-block">
            sandbox · máx R$ 430
          </span>
        </label>

        <div className="mt-6 flex flex-wrap gap-2">
          {QUOTE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmountBrl(p)}
              className={`font-mono text-xs px-4 py-2 rounded-full border transition-colors ${
                amountBrl === p
                  ? 'bg-base text-white border-base'
                  : 'bg-white text-base border-base/20 hover:border-base'
              }`}
            >
              R$ {p}
            </button>
          ))}
        </div>

        {quote && (
          <div className="mt-12">
            <div className="flex items-baseline justify-between mb-4">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
                Breakdown
              </p>
              {expiresIn && (
                <p className="font-mono text-[11px] text-base/65">
                  expira em <span className="text-base">{expiresIn}</span>
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-px bg-base/10 border-y border-light-hairline">
              <QuoteCell label="Você paga" value={BRL.format(Number(quote.fromAmount))} />
              <QuoteCell
                label="PLINA-RF (paridade POC)"
                value={NUMBER_BR.format(Number(quote.toAmount))}
                accent
              />
              <QuoteCell
                label="Câmbio"
                value={NUMBER_BR.format(Number(quote.exchangeRate))}
              />
              <QuoteCell label="Fee" value={BRL.format(Number(quote.fee))} />
            </dl>
            <p className="font-mono text-[10px] text-base/55 mt-3">
              em produção, swap real <Term>TESOURO</Term> → PLINA-RF via distributor Plina
            </p>

            <div className="mt-12">
              <button
                onClick={onContinue}
                disabled={buildLoading || loading}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-3"
              >
                {buildLoading && (
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
                )}
                {buildLoading ? 'Preparando transação…' : 'Revisar compra'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OnRampScreen({
  onRamp,
  quote,
  paying,
  onSandboxPay,
  onSkipToSettling,
}: {
  onRamp: OnRampData;
  quote: QuoteData;
  paying: boolean;
  onSandboxPay: () => void;
  onSkipToSettling: () => void;
}) {
  const instructions = onRamp.paymentInstructions;
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        04 // Pagamento · <Term>onramp</Term> BRL → TESOURO
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {onRamp.mock
          ? 'Sandbox mock — pague simulado'
          : 'Pague via PIX para a anchor'}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {onRamp.mock ? (
          <>
            Bank account PIX não está ativa (PLINA-MOD-005 — exige iframe
            Etherfuse em produção). Em sandbox usamos um <em>mock</em>:
            simulamos o PIX como pago e flipamos a order pra <code>completed</code>.
          </>
        ) : (
          <>
            Pague o PIX abaixo do seu banco. A Etherfuse confirma o
            recebimento e paga TESOURO na sua wallet Stellar
            automaticamente (~10-30s após confirmação).
          </>
        )}
      </p>

      <div className="mt-10 border-y border-light-hairline">
        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Valor (BRL)"
            v={
              <span className="font-mono text-sm">
                {BRL.format(Number(quote.fromAmount))}
              </span>
            }
          />
          <DataRow
            k="Chave PIX"
            v={
              <span className="font-mono text-xs break-all">
                {instructions?.pixKey ?? instructions?.pixCode ?? '—'}
              </span>
            }
          />
          <DataRow
            k="Beneficiário"
            v={
              <span className="font-mono text-xs">
                {instructions?.beneficiary ?? 'Etherfuse Brasil'}
              </span>
            }
          />
          <DataRow
            k="Order ID"
            v={
              <span className="font-mono text-[11px] text-base/75">
                {onRamp.orderId}
              </span>
            }
          />
          <DataRow
            k="Status"
            v={
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/75">
                ○ {onRamp.status}
                {onRamp.mock && ' · mock'}
              </span>
            }
          />
        </dl>
      </div>

      <div className="mt-12 flex flex-wrap gap-4">
        {onRamp.mock ? (
          <button
            onClick={onSandboxPay}
            disabled={paying}
            className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-3"
          >
            {paying && (
              <span
                className="w-2 h-2 bg-primary rounded-full animate-pulse"
                aria-hidden
              />
            )}
            {paying ? 'Simulando PIX…' : 'Simular PIX pago (sandbox)'}
          </button>
        ) : (
          <button
            onClick={onSkipToSettling}
            className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200"
          >
            Já paguei · acompanhar liquidação
          </button>
        )}
      </div>
    </div>
  );
}

function SettlingScreen({
  onRamp,
  quote,
  swapLoading,
  onContinue,
}: {
  onRamp: OnRampData;
  quote: QuoteData;
  swapLoading: boolean;
  onContinue: () => void;
}) {
  const done = onRamp.status === 'completed';
  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        05 // Liquidação · TESOURO na sua wallet
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        {done ? 'TESOURO liquidado — prossiga' : 'Aguardando settlement…'}
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {done ? (
          <>
            A anchor pagou TESOURO na sua wallet. Próximo passo: assinar o
            envelope <Term>swap atômico</Term> que troca TESOURO por PLINA-RF
            on-chain numa única transação.
          </>
        ) : (
          <>
            A Etherfuse está indexando o pagamento. Polling a cada 3s.
            Indexing grace de ~12s antes de marcar falha.
          </>
        )}
      </p>

      <div className="mt-10 border-y border-light-hairline">
        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Order"
            v={
              <span className="font-mono text-[11px] text-base/75">
                {onRamp.orderId}
              </span>
            }
          />
          <DataRow
            k="Status"
            v={
              <span
                className={`font-details text-[10px] tracking-[0.2em] uppercase ${
                  done ? 'text-primary-deep' : 'text-base/70'
                }`}
              >
                {done ? '●' : '○'} {onRamp.status}
                {onRamp.mock && ' · mock'}
              </span>
            }
          />
          {onRamp.stellarTxHash && (
            <DataRow
              k="TESOURO tx"
              v={
                onRamp.stellarTxHash.startsWith('mock-') ? (
                  <span className="font-mono text-[11px] text-base/75">
                    {onRamp.stellarTxHash}
                  </span>
                ) : (
                  <a
                    href={explorerTx(onRamp.stellarTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-base hover:text-primary-deep underline decoration-base/25 underline-offset-4 break-all"
                  >
                    {onRamp.stellarTxHash}
                  </a>
                )
              }
            />
          )}
          <DataRow
            k="A receber"
            v={
              <span className="font-mono text-sm">
                {NUMBER_BR.format(Number(quote.toAmount))} PLINA-RF
              </span>
            }
          />
        </dl>
      </div>

      <div className="mt-12">
        <button
          onClick={onContinue}
          disabled={!done || swapLoading}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
        >
          {swapLoading && (
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
          )}
          {swapLoading
            ? 'Preparando envelope…'
            : done
              ? 'Continuar para revisão do swap'
              : 'Aguardando settlement…'}
        </button>
      </div>
    </div>
  );
}

function ConfirmScreen({
  onboard,
  quote,
  swap,
  signConfirmed,
  setSignConfirmed,
  buying,
  onConfirm,
}: {
  onboard: OnboardData;
  quote: QuoteData;
  swap: SwapEnvelope;
  signConfirmed: boolean;
  setSignConfirmed: (v: boolean) => void;
  buying: boolean;
  onConfirm: () => void;
}) {
  const [showXdr, setShowXdr] = useState(false);

  return (
    <div>
      <TestnetBanner />

      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        06 // Revisão · swap atômico
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Inspecione antes de assinar.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Você assina um envelope <Term>swap atômico</Term> com 2 legs: você
        paga TESOURO ao distributor, distributor te paga PLINA-RF. As duas
        operações commitam juntas — sem TESOURO, sem PLINA-RF. Distributor já
        co-assinou server-side.
      </p>

      <div className="mt-12 border-t border-light-hairline">
        <div className="py-8 border-b border-light-hairline">
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
            Você receberá
          </p>
          <p className="font-mono text-5xl md:text-6xl mt-4 text-base font-medium tracking-tight">
            {NUMBER_BR.format(Number(quote.toAmount))}
            <span className="font-mono text-2xl md:text-3xl text-base/45 ml-3">PLINA-RF</span>
          </p>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mt-3">
            <Term>paridade NAV</Term> · 1 PLINA-RF = 1 BRL · POC
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-px bg-base/10">
          <DataRow
            k="Você paga (BRL)"
            v={<span className="font-mono text-sm">{BRL.format(Number(quote.fromAmount))}</span>}
          />
          <DataRow
            k="Wallet destino"
            v={
              <span className="font-mono text-xs" title={onboard.publicKey}>
                {maskPubkey(onboard.publicKey)}
              </span>
            }
          />
          <DataRow
            k="Distributor"
            v={
              <span className="font-mono text-xs" title={swap.distributorPubkey}>
                {maskPubkey(swap.distributorPubkey)} · co-assinado
              </span>
            }
          />
          <DataRow
            k="Hash a assinar"
            v={
              <span className="font-mono text-[11px] break-all text-base/75">
                {swap.hashHex}
              </span>
            }
          />
          <DataRow
            k="Operações on-chain"
            v={
              <span className="font-mono text-xs text-base/75">
                payment TESOURO · payment PLINA-RF (atômico)
              </span>
            }
          />
          <DataRow
            k="Cláusula clawback"
            v={
              <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/75">
                <Term>clawback</Term> · hipóteses §6.5
              </span>
            }
          />
        </dl>

        <div className="border-y border-light-hairline">
          <button
            type="button"
            onClick={() => setShowXdr((v) => !v)}
            className="w-full text-left px-1 py-4 flex items-center justify-between hover:bg-lightBg/40 transition-colors"
            aria-expanded={showXdr}
          >
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base">
              {showXdr ? '— Ocultar XDR' : '+ Inspecionar XDR completo'}
            </span>
            <span className="font-mono text-[10px] text-base/55">
              base64 · stellar envelope
            </span>
          </button>
          {showXdr && (
            <pre className="bg-lightBg/60 border-t border-light-hairline px-4 py-4 font-mono text-[10px] text-base/75 whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {swap.xdr}
            </pre>
          )}
        </div>
      </div>

      <label className="mt-10 flex items-start gap-4 cursor-pointer group">
        <span
          className={`mt-0.5 w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors ${
            signConfirmed ? 'bg-base border-base' : 'bg-white border-base/40 group-hover:border-base'
          }`}
          aria-hidden
        >
          {signConfirmed && (
            <span className="font-mono text-xs text-white leading-none">✓</span>
          )}
        </span>
        <span className="font-text text-sm text-base/85 leading-relaxed">
          <input
            type="checkbox"
            checked={signConfirmed}
            onChange={(e) => setSignConfirmed(e.target.checked)}
            className="sr-only"
            aria-label="Confirmo destinatário e hash"
          />
          Revisei o destinatário{' '}
          <span className="font-mono text-xs text-base">{maskPubkey(onboard.publicKey)}</span>,
          o asset PLINA-RF e o hash da transação. Estou ciente de que esta é uma operação
          em testnet sem valor financeiro real.
        </span>
      </label>

      <div className="mt-10">
        <button
          onClick={onConfirm}
          disabled={buying || !signConfirmed}
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-10 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
        >
          {buying ? (
            <span className="inline-flex items-center gap-3">
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
              Submetendo swap atômico…
            </span>
          ) : (
            'Assinar e executar swap'
          )}
        </button>
        {!buying && (
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-4">
            Pop-up Privy vai pedir confirmação da assinatura
          </p>
        )}
      </div>
    </div>
  );
}

function ReceiptScreen({
  onboard,
  quote,
  buyResult,
  onBuyMore,
}: {
  onboard: OnboardData;
  quote: QuoteData;
  buyResult: BuyResult;
  onBuyMore: () => void;
}) {
  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-deep mr-2 align-middle" aria-hidden />
        07 // {buyResult.mock ? 'Distribuição (mock sandbox) concluída' : 'Swap atômico concluído'}
      </p>
      <h1 className="font-title text-4xl md:text-5xl font-semibold mt-4 tracking-tight leading-[1.05] text-base">
        {NUMBER_BR.format(Number(quote.toAmount))}
        <span className="font-mono text-2xl md:text-3xl text-base/55 ml-3">PLINA-RF</span>
      </h1>
      <p className="font-text text-base mt-6 text-base/80 leading-relaxed max-w-prose">
        Na sua wallet Stellar institucional. Lastreado em direito creditório
        brasileiro sob CVM 175.{' '}
        {buyResult.mock
          ? 'Sandbox sem PIX real: distribuição direta server-side (PLINA-MOD-005 bypass).'
          : 'Swap atômico — 2 legs commitam juntas, settlement on-chain real.'}
      </p>

      <div className="mt-14">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mb-4">
          Transações on-chain
        </p>
        <ol className="space-y-px bg-base/10 border-y border-light-hairline">
          {buyResult.onRampTxHash && (
            <TxRow
              label={buyResult.mock ? 'onramp (mock)' : 'onramp · TESOURO'}
              hash={buyResult.onRampTxHash}
              idx={1}
            />
          )}
          <TxRow
            label={buyResult.mock ? 'distribute' : 'swap atômico'}
            hash={buyResult.swapTxHash}
            idx={buyResult.onRampTxHash ? 2 : 1}
          />
        </ol>
        <p className="font-mono text-[10px] text-base/55 mt-3">
          {buyResult.mock
            ? 'mock sandbox · sem TESOURO on-chain'
            : 'investidor assinou envelope · distributor co-assinou · 2 legs em 1 tx'}
        </p>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3">
        <a
          href="/minha-posicao"
          className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200"
        >
          Minha posição
        </a>
        <a
          href={explorerAccount(onboard.publicKey)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 hover:text-base transition-colors"
        >
          Ver no Stellar Expert →
        </a>
      </div>

      <div className="mt-16 pt-8 border-t border-light-hairline flex flex-wrap items-center gap-x-8 gap-y-3">
        <button
          onClick={onBuyMore}
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors"
        >
          Comprar mais
        </button>
        <a
          href="/pool"
          className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors"
        >
          Pool atualizado →
        </a>
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */

function useExpiresIn(expiresAt?: string | null): string | null {
  const target = useMemo(() => {
    if (!expiresAt) return null;
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t)) return t;
    return Date.now() + QUOTE_TTL_MS;
  }, [expiresAt]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  const diffMs = target - now;
  if (diffMs <= 0) return '00:00';
  const s = Math.floor(diffMs / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function DataRow({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 sm:min-w-[180px]">
        {k}
      </span>
      <span className={`${mono ? 'font-mono text-xs' : 'text-sm'} text-base break-all`}>{v}</span>
    </div>
  );
}

function QuoteCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-6">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
        {label}
      </p>
      <p
        className={`font-mono text-xl mt-3 ${accent ? 'text-primary-deep font-medium' : 'text-base'}`}
      >
        {value}
      </p>
    </div>
  );
}

function TxRow({ label, hash, idx }: { label: string; hash: string; idx: number }) {
  return (
    <li className="relative bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 group hover:bg-lightBg/30 transition-colors">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[2px] bg-primary scale-y-100 origin-top"
      />
      <span className="font-mono text-[11px] text-primary-deep sm:min-w-[24px]">
        {String(idx).padStart(2, '0')}
      </span>
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base sm:min-w-[100px]">
        {label}
      </span>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[11px] text-base/85 hover:text-primary-deep transition-colors break-all flex-1"
      >
        {hash}
      </a>
    </li>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function OnboardingProgress() {
  const phases = [
    'Criando wallet Stellar embedded',
    'Registrando customer na anchor',
    'Submetendo KYC programático',
    'Confirmando aprovação',
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= phases.length) return;
    const id = setTimeout(() => setStep((s) => s + 1), 1400);
    return () => clearTimeout(id);
  }, [step, phases.length]);

  return (
    <div>
      <ol className="space-y-px bg-base/10 border-y border-light-hairline">
        {phases.map((p, idx) => {
          const isDone = idx < step;
          const isCurrent = idx === step;
          return (
            <li
              key={p}
              className="relative bg-white px-5 py-4 flex items-center gap-5"
            >
              <span
                aria-hidden
                className={`absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isDone || isCurrent ? 'scale-y-100' : 'scale-y-0'
                } ${isCurrent ? 'bg-primary' : 'bg-base/25'}`}
              />
              <span
                className={`font-mono text-xs transition-colors ${
                  isDone ? 'text-primary-deep' : isCurrent ? 'text-base' : 'text-base/35'
                }`}
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span
                className={`font-text text-sm transition-colors flex-1 ${
                  isCurrent ? 'text-base' : isDone ? 'text-base/70' : 'text-base/40'
                }`}
              >
                {p}
                {isCurrent && <span className="animate-pulse">…</span>}
              </span>
              {isDone && (
                <span
                  className="font-mono text-[10px] text-primary-deep"
                  aria-label="concluído"
                >
                  ✓
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 mt-3">
        Sandbox auto-aprova · ~3-8s
      </p>
    </div>
  );
}
