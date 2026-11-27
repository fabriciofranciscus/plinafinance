'use client';

import { useActionState } from 'react';
import { registrarValidacaoLegalAction, type ActionResult } from './actions';
import { txExplorerUrl } from '@/lib/stellar/explorer';
import { nomeDaRede, useRevisaoDeFormulario } from './revisao-acao';

/**
 * Form inline pra registrar laudo de validação legal numa cota (whitepaper
 * §6.1). Grava SHA-256 do laudo em Memo.hash + persiste em Cota.
 */
export function ValidacaoForm({
  cotaId,
  hasValidacao,
  descricaoCota,
  redePublica = false,
}: {
  cotaId: string;
  hasValidacao: boolean;
  /** Como a cota aparece na tabela (tipo, administradora, valor), para a Revisão. */
  descricaoCota?: string;
  redePublica?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    registrarValidacaoLegalAction,
    null,
  );
  // Enviar (botão ou Enter) abre a Revisão; só a confirmação grava o hash on-chain.
  const revisao = useRevisaoDeFormulario((d) => {
    const rede = nomeDaRede(redePublica);
    return {
      titulo: 'Revisar antes de validar a cota',
      linhas: [
        { rotulo: 'Cota', valor: <span><span className="font-mono">{cotaId.slice(0, 8)}…</span>{descricaoCota ? ` · ${descricaoCota}` : ''}</span> },
        { rotulo: 'Laudo', valor: <span className="break-all font-mono text-sm">{String(d.get('laudoUrl') ?? '')}</span> },
        { rotulo: 'Rede', valor: rede },
      ],
      consequencia: `Grava o hash do laudo na ${rede}, ligado a esta cota. O registro é público e não pode ser apagado.`,
      atesto: `Conferi a cota e o laudo, e entendo que o hash fica registrado na ${rede}.`,
      confirmar: 'Validar cota',
    };
  });

  if (hasValidacao && !state?.ok) {
    return (
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
        ✓ validada
      </span>
    );
  }

  return (
    <>
    <form action={formAction} {...revisao.formProps} className="flex flex-col md:flex-row md:items-center gap-2">
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
          href={txExplorerUrl(state.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] underline text-primary-deep"
        >
          ✓ {state.txHash.slice(0, 10)}…
        </a>
      )}
    </form>
    {revisao.painel}
    </>
  );
}
