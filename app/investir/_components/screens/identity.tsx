'use client';

import { useAppPrivy as usePrivy } from '@/lib/hooks/privy';
import type { OnboardData } from '../../_types';
import { explorerAccount, maskId } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';
import { OnboardingProgress } from '../shared/onboarding-progress';

export function IdentityScreen({
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
