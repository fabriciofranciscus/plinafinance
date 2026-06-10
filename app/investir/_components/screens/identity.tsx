'use client';

import { useAppPrivy as usePrivy } from '@/lib/hooks/privy';
import type {
  EntityType,
  InstitutionalProfile,
  InvestorTrack,
  OnboardData,
} from '../../_types';
import { explorerAccount, maskId } from '../../_lib/format';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { DataRow } from '../shared/data-row';
import { OnboardingProgress } from '../shared/onboarding-progress';
import { INTL_FLOW_ENABLED } from '../../_lib/flags-client';

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
  track,
  onTrackChange,
  institutionalProfile,
  onInstitutionalChange,
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
  track: InvestorTrack;
  onTrackChange: (t: InvestorTrack) => void;
  institutionalProfile: InstitutionalProfile | null;
  onInstitutionalChange: (p: InstitutionalProfile) => void;
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

      {/* Trilha: Institucional BR (funcional) / Internacional (M4, gated). */}
      <div className="mt-8 inline-flex rounded-full border border-base/20 p-1">
        {([
          { id: 'BR' as const, label: 'Institucional BR', range: 'R$ 500k–10M', enabled: true },
          { id: 'INTL' as const, label: 'Internacional', range: 'US$ 100k–5M', enabled: INTL_FLOW_ENABLED },
        ]).map((t) => {
          const active = track === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => t.enabled && onTrackChange(t.id)}
              disabled={!t.enabled}
              aria-pressed={active}
              title={t.enabled ? undefined : 'Em breve'}
              className={`rounded-full px-5 py-2 font-details text-[11px] tracking-[0.15em] uppercase transition-colors ${
                active
                  ? 'bg-base text-white'
                  : t.enabled
                    ? 'text-base/60 hover:text-base'
                    : 'text-base/30 cursor-not-allowed'
              }`}
            >
              {t.label}
              <span className="ml-2 font-mono text-[10px] opacity-70">
                {t.enabled ? t.range : 'em breve'}
              </span>
            </button>
          );
        })}
      </div>

      <EntityOnboarding
        track={track}
        profile={institutionalProfile}
        onChange={onInstitutionalChange}
      />

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
                disabled={!trustlinesReady || !isEntidadeValida(track, institutionalProfile)}
                className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continuar para cotação
              </button>
              {trustlinesReady && !isEntidadeValida(track, institutionalProfile) && (
                <p className="mt-3 font-details text-[10px] tracking-[0.2em] uppercase text-base/55">
                  Preencha os dados da entidade para continuar
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function emptyProfile(track: InvestorTrack): InstitutionalProfile {
  return {
    entityName: '',
    jurisdiction: track === 'BR' ? 'BR' : '',
    cnpj: '',
    entityType: 'FAMILY_OFFICE',
    estimatedTicket: '',
    currency: track === 'BR' ? 'BRL' : 'USDC',
  };
}

const ENTITY_TYPES: { v: EntityType; label: string }[] = [
  { v: 'FAMILY_OFFICE', label: 'Family Office' },
  { v: 'ASSET_MANAGER', label: 'Gestora' },
  { v: 'FUND', label: 'Fundo' },
  { v: 'OTHER', label: 'Outro' },
];

const fieldCls =
  'mt-2 block w-full bg-white border border-base/20 px-3 py-2.5 font-text text-sm text-base focus:outline-none focus:border-base transition-colors';

/**
 * Entidade preenchida o suficiente pra avançar? BR exige razão social + CNPJ
 * (14 dígitos); INTL exige razão social + jurisdição. Validação client-side —
 * o CNPJ é re-validado (mod-11) no endpoint /api/investidor/entidade.
 */
export function isEntidadeValida(
  track: InvestorTrack,
  profile: InstitutionalProfile | null,
): boolean {
  if (!profile) return false;
  if (!profile.entityName.trim()) return false;
  if (track === 'BR') {
    return (profile.cnpj ?? '').replace(/\D/g, '').length === 14;
  }
  return profile.jurisdiction.trim().length === 2;
}

/**
 * Onboarding institucional (cartão 1 do mockup do CEO). Tab-aware: BR coleta
 * Razão social/CNPJ/Tipo/Ticket R$; INTL coleta Razão social/Jurisdição/Tipo/
 * Ticket US$. Persistido em colunas do Investidor via /api/investidor/entidade
 * (disparado no "Continuar"). entityType/estimatedTicket vão só no audit log.
 */
function EntityOnboarding({
  track,
  profile,
  onChange,
}: {
  track: InvestorTrack;
  profile: InstitutionalProfile | null;
  onChange: (p: InstitutionalProfile) => void;
}) {
  const p = profile ?? emptyProfile(track);
  const set = (patch: Partial<InstitutionalProfile>) => onChange({ ...p, ...patch });
  const isBR = track === 'BR';

  return (
    <div className="mt-10 border border-base/15 bg-white p-6 md:p-7">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        Onboarding institucional
      </p>
      <p className="font-text text-sm text-base/70 mt-1">
        {isBR
          ? 'Investidor Qualificado / Profissional (CVM 30). Dados da entidade brasileira.'
          : 'KYC via anchor regulada na sua jurisdição (MoneyGram · Settle · anchors europeias SEP-compliant).'}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Razão social
          </span>
          <input
            type="text"
            value={p.entityName}
            onChange={(e) => set({ entityName: e.target.value })}
            placeholder={isBR ? 'Família Investimentos LTDA' : 'Acme Capital Ltd.'}
            className={fieldCls}
          />
        </label>
        {isBR ? (
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              CNPJ
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={p.cnpj ?? ''}
              onChange={(e) => set({ cnpj: e.target.value })}
              placeholder="00.000.000/0001-00"
              className={fieldCls + ' font-mono'}
            />
          </label>
        ) : (
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Jurisdição (ISO alpha-2)
            </span>
            <input
              type="text"
              maxLength={2}
              value={p.jurisdiction}
              onChange={(e) => set({ jurisdiction: e.target.value.toUpperCase() })}
              placeholder="KY"
              className={fieldCls + ' font-mono uppercase'}
            />
          </label>
        )}
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Tipo
          </span>
          <select
            value={p.entityType}
            onChange={(e) => set({ entityType: e.target.value as EntityType })}
            className={fieldCls}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Ticket estimado ({isBR ? 'R$' : 'USD'})
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={p.estimatedTicket}
            onChange={(e) => set({ estimatedTicket: e.target.value })}
            placeholder={isBR ? '2.500.000' : '500.000'}
            className={fieldCls + ' font-mono'}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(isBR
          ? ['Suitability CVM 30', 'Investidor Qualificado / Profissional']
          : ['SEP-24 · onboarding hosted', 'SEP-12 · KYC reutilizável']
        ).map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[11px] text-base/70"
          >
            <span className="h-1 w-1 rounded-full bg-primary" />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
