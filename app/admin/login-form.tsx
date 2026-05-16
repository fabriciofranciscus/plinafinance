'use client';

import { useActionState } from 'react';
import { passwordLoginAction, type ActionResult } from './actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    passwordLoginAction,
    null,
  );

  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        Painel da operação · acesso restrito
      </p>
      <h1 className="font-title mt-3 text-3xl font-semibold tracking-tight">
        Plina · operação
      </h1>
      <p className="font-text mt-3 text-sm text-base/70">
        Painel interno para incorporação de cotas e eventos de compliance.
        Senha única configurada por env var no POC.
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Senha
          </span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            className="mt-2 w-full bg-white border border-light-hairline px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        {state?.error && (
          <p className="font-text text-sm text-red-700">{state.error}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {pending ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
