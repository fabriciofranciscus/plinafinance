'use client';

/**
 * /investir — fluxo do investidor institucional.
 *
 * Telas guiadas: welcome → identity → banking → quote → onramp →
 * settling → claiming → confirm → receipt. Whitepaper §6.6. ARCHITECTURE §3.5/§3.6.
 *
 * Shell de orquestração: estado de fluxo + composição de hooks vive em
 * `_hooks/use-investir-flow.ts`. Cada Screen em `_components/screens/`.
 */

import {
  useAppLoginWithEmail as useLoginWithEmail,
  useAppLoginWithOAuth as useLoginWithOAuth,
  useAppLogout as useLogout,
} from '@/lib/hooks/privy';
import { SCREENS } from './_lib/glossary';
import { useInvestirFlow } from './_hooks/use-investir-flow';
import { Rail } from './_components/shell/rail';
import { ScreenFader } from './_components/shell/screen-fader';
import { ErrorBlock } from './_components/shell/error-block';
import { WelcomeScreen } from './_components/screens/welcome';
import { IdentityScreen } from './_components/screens/identity';
import { BankingScreen } from './_components/screens/banking';
import { ClasseScreen } from './_components/screens/classe';
import { QuoteScreen } from './_components/screens/quote';
import { OnRampScreen } from './_components/screens/onramp';
import { SettlingScreen } from './_components/screens/settling';
import { ClaimingScreen } from './_components/screens/claiming';
import { ConfirmScreen } from './_components/screens/confirm';
import { ReceiptScreen } from './_components/screens/receipt';

export default function InvestirPage() {
  const flow = useInvestirFlow();
  const { logout } = useLogout();
  const emailLogin = useLoginWithEmail();
  const oauthLogin = useLoginWithOAuth();
  const { ready, authenticated, user } = flow.privy;

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando Privy…
        </p>
      </div>
    );
  }

  const { screen } = flow;
  const onboard = flow.onboard.onboard;
  const quote = flow.quote.quote;
  const onRamp = flow.onRamp.onRamp;
  const swapBuild = flow.swap.swapBuild;
  const buyResult = flow.swap.buyResult;

  const currentIdx = SCREENS.findIndex((s) => s.id === screen);
  const canGoBack = authenticated && screen !== 'welcome' && screen !== 'receipt';

  return (
    <div className="bg-lightBg min-h-screen">
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-[260px_1fr] md:gap-px md:bg-base/10">
        <aside className="hidden md:block bg-lightBg sticky top-0 self-start h-screen">
          <Rail
            current={screen}
            onboard={!!onboard}
            quote={!!quote}
            buyResult={!!buyResult}
          />
        </aside>

        <div className="md:hidden bg-lightBg border-b border-light-hairline px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-primary-deep">
              {String(currentIdx + 1).padStart(2, '0')} /{' '}
              {String(SCREENS.length).padStart(2, '0')}
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
                onClick={flow.goBack}
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
                  onboarding={flow.onboard.onboarding}
                  consented={flow.kycConsented}
                  onConsent={flow.consentAndOnboard}
                  user={user}
                  trustlinesReady={flow.trustlines.trustlinesReady}
                  trustlineLoading={flow.trustlines.trustlineLoading}
                  onSetupTrustlines={flow.trustlines.setupTrustlines}
                  onContinue={flow.onIdentityContinue}
                  onRetry={flow.onboard.runOnboard}
                />
              )}
              {screen === 'banking' && onboard && (
                <BankingScreen
                  bankInfo={flow.banking.bankInfo}
                  pixKey={flow.banking.fields.pixKey}
                  setPixKey={flow.banking.fields.setPixKey}
                  pixKeyType={flow.banking.fields.pixKeyType}
                  setPixKeyType={flow.banking.fields.setPixKeyType}
                  firstName={flow.banking.fields.firstName}
                  setFirstName={flow.banking.fields.setFirstName}
                  lastName={flow.banking.fields.lastName}
                  setLastName={flow.banking.fields.setLastName}
                  cpf={flow.banking.fields.cpf}
                  setCpf={flow.banking.fields.setCpf}
                  loading={flow.banking.loading}
                  onSubmit={flow.banking.registerBank}
                  onSkip={flow.skipBanking}
                />
              )}
              {screen === 'classe' && onboard && (
                <ClasseScreen
                  initial={flow.classe}
                  onContinue={flow.onClasseContinue}
                />
              )}
              {screen === 'quote' && onboard && (
                <QuoteScreen
                  amountBrl={flow.quote.amountBrl}
                  setAmountBrl={flow.quote.setAmountBrl}
                  quote={quote}
                  loading={flow.quote.quoteLoading}
                  buildLoading={flow.onRamp.onRampLoading}
                  onContinue={flow.onRamp.goToOnramp}
                />
              )}
              {screen === 'onramp' && onboard && quote && onRamp && (
                <OnRampScreen
                  onRamp={onRamp}
                  quote={quote}
                  paying={flow.onRamp.paying}
                  onSandboxPay={flow.onRamp.sandboxPay}
                  onSkipToSettling={() => flow.setScreen('settling')}
                />
              )}
              {screen === 'settling' && onboard && quote && onRamp && (
                <SettlingScreen
                  onRamp={onRamp}
                  quote={quote}
                  swapLoading={flow.swap.swapLoading}
                  onContinue={flow.swap.goToConfirm}
                />
              )}
              {screen === 'claiming' && onboard && onRamp && (
                <ClaimingScreen
                  onRamp={onRamp}
                  claimResult={flow.claim.claimResult}
                  claiming={flow.claim.claiming}
                  swapLoading={flow.swap.swapLoading}
                  onClaim={flow.claim.doClaim}
                  onContinue={flow.swap.goToConfirm}
                />
              )}
              {screen === 'confirm' &&
                onboard &&
                quote &&
                swapBuild &&
                !swapBuild.mock && (
                  <ConfirmScreen
                    onboard={onboard}
                    quote={quote}
                    swap={swapBuild}
                    signConfirmed={flow.swap.signConfirmed}
                    setSignConfirmed={flow.swap.setSignConfirmed}
                    buying={flow.swap.buying}
                    onConfirm={flow.swap.buy}
                  />
                )}
              {screen === 'receipt' && onboard && quote && buyResult && (
                <ReceiptScreen
                  onboard={onboard}
                  quote={quote}
                  buyResult={buyResult}
                  onBuyMore={flow.onBuyMore}
                />
              )}
            </ScreenFader>

            {flow.error && (
              <ErrorBlock error={flow.error} onDismiss={flow.dismissError} />
            )}

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
