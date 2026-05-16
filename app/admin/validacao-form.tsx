'use client';

import { useActionState } from 'react';
import { registrarValidacaoLegalAction, type ActionResult } from './actions';

/**
 * Form inline pra registrar laudo de validação legal numa cota (whitepaper
 * §6.1). Grava SHA-256 do laudo em Memo.hash + persiste em Cota.
 */
export function ValidacaoForm({
  cotaId,
  hasValidacao,
}: {
  cotaId: string;
  hasValidacao: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    registrarValidacaoLegalAction,
    null,
  );

  if (hasValidacao && !state?.ok) {
    return (
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        ✓ validada
      </span>
    );
  }

  return (
    <form action={formAction} className="flex flex-col md:flex-row md:items-center gap-2">
      <input type="hidden" name="cotaId" value={cotaId} />
      <input
        type="url"
        name="laudoUrl"
        required
        placeholder="https://…/laudo.pdf"
        className="flex-1 bg-white border border-light-hairline px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="submit"
        disabled={pending}
        className="font-details text-[10px] tracking-[0.2em] uppercase border border-light-hairline px-2 py-1 hover:bg-base hover:text-lightBg disabled:opacity-50"
      >
        {pending ? '…' : 'Validar'}
      </button>
      {state?.error && (
        <span className="font-text text-[11px] text-red-700">{state.error}</span>
      )}
      {state?.ok && state.txHash && (
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${state.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] underline text-primary-deep"
        >
          ✓ {state.txHash.slice(0, 10)}…
        </a>
      )}
    </form>
  );
}
