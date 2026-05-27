'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useAppLoginWithEmail as useLoginWithEmail,
  useAppLoginWithOAuth as useLoginWithOAuth,
} from '@/lib/hooks/privy';
import { TestnetBanner } from '../shell/testnet-banner';
import { Term } from '../shared/term';
import { GoogleMark } from '../shared/google-mark';

export function WelcomeScreen({
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
