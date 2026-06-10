'use client';

/**
 * LoginPanel — UI de login (Google + código por email) compartilhada.
 *
 * Extraída do welcome do /investir pra centralizar o login que vivia duplicado
 * (welcome + passo 0 do /vender). Apresentação pura: recebe os hooks Privy via
 * props (`emailLogin`/`oauthLogin`) pra preservar o caminho do stub E2E — quem
 * monta os hooks é o caller (a página), não este componente.
 *
 * `variant`:
 *   - 'standalone' — superfície de /entrar (campos com borda inferior, hero).
 *   - 'embedded'   — dentro de um card de wizard (preparado p/ adotar no /vender).
 */

import { useEffect, useRef, useState } from 'react';
import {
  useAppLoginWithEmail as useLoginWithEmail,
  useAppLoginWithOAuth as useLoginWithOAuth,
} from '@/lib/hooks/privy';
import { GoogleMark } from '@/app/investir/_components/shared/google-mark';

export function LoginPanel({
  emailLogin,
  oauthLogin,
  variant = 'standalone',
  emailLabel = 'Email institucional',
  emailPlaceholder = 'voce@familyoffice.com',
}: {
  emailLogin: ReturnType<typeof useLoginWithEmail>;
  oauthLogin: ReturnType<typeof useLoginWithOAuth>;
  variant?: 'standalone' | 'embedded';
  emailLabel?: string;
  emailPlaceholder?: string;
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

  const inputBase =
    variant === 'standalone'
      ? 'mt-3 block w-full bg-transparent border-b border-base/30 focus:border-base placeholder:text-base/30 py-3 focus:outline-none transition-colors disabled:opacity-50'
      : 'mt-3 block w-full bg-white border border-base/20 px-3 py-2.5 focus:border-base placeholder:text-base/30 focus:outline-none transition-colors disabled:opacity-50';

  return (
    <div>
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
              {emailLabel}
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder={emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sending}
              className={`${inputBase} font-mono text-xl md:text-2xl text-base`}
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
              className={`${inputBase} font-mono text-3xl md:text-4xl text-base tracking-[0.4em] placeholder:text-base/25`}
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
  );
}
