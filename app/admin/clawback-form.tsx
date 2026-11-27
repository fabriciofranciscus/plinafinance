'use client';

import { useActionState, useEffect, useState } from 'react';
import { executarClawbackAction, type ActionResult } from './actions';
import { semNotacaoCientifica } from '@/lib/format/campo-numerico';
import { txExplorerUrl } from '@/lib/stellar/explorer';

const motivoOptions = [
  { value: 'DECISAO_JUDICIAL', label: 'Decisão judicial' },
  { value: 'SANCAO_REGULATORIA', label: 'Sanção regulatória' },
  { value: 'FRAUDE_DOCUMENTAL', label: 'Fraude documental' },
  { value: 'ERRO_OPERACIONAL', label: 'Erro operacional' },
];

export function ClawbackForm({
  investidorId,
  investidorEmail,
  saldoEsperado,
}: {
  investidorId: string;
  investidorEmail: string;
  saldoEsperado: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    executarClawbackAction,
    null,
  );
  // Chave de idempotência do PEDIDO (U1-11): o mesmo valor em reenvios/duplo clique; renova depois de cada resposta, exceto quando
  // o servidor diz que o clawback já foi à rede e falta só o registro (reenviar o MESMO pedido conclui sem repetir).
  const [pedidoId, setPedidoId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    // Mantém a chave quando o resultado é pendente ou incerto: reenviar o MESMO pedido nunca duplica (recarregar a tela gera outro).
    const manter = ['REGISTRO_PENDENTE', 'EXECUCAO_INCERTA', 'PEDIDO_EM_ANDAMENTO'];
    if (state && !manter.includes(state.code ?? '')) setPedidoId(crypto.randomUUID());
  }, [state]);

  return (
    <form action={formAction} className="space-y-4 pt-4">
      <input type="hidden" name="investidorId" value={investidorId} />
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <p className="font-details text-label-ui text-base/70">
        Clawback · política pública 4 hipóteses
      </p>
      <p className="font-text text-body-small text-base/70">
        Alvo: {investidorEmail} · Saldo esperado: <span className="font-mono">{saldoEsperado}</span>
      </p>
      <div className="grid grid-cols-1 gap-4">
        <label className="block">
          <span className="font-details text-label-ui text-base/70">
            Quantidade
          </span>
          <input
            type="number"
            onKeyDown={semNotacaoCientifica}
            name="amount"
            step="0.0000001"
            min="0.0000001"
            required
            placeholder="100"
            className={inputClass + ' font-mono'}
          />
        </label>
        <label className="block">
          <span className="font-details text-label-ui text-base/70">
            Motivo
          </span>
          <select name="motivo" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              selecionar…
            </option>
            {motivoOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-details text-label-ui text-base/70">
            URL fundamento
          </span>
          <input
            type="url"
            name="fundamentoUrl"
            required
            placeholder="https://…/decisao.pdf"
            className={inputClass + ' font-mono'}
          />
        </label>
      </div>

      {state?.error && (
        <p className="font-text text-body-small text-danger">{state.error}</p>
      )}
      {state?.ok && state.txHash && (
        <p className="font-text text-body-small text-base/80">
          ✓ Clawback executado. Tx:{' '}
          <a
            href={txExplorerUrl(state.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs underline"
          >
            {state.txHash.slice(0, 16)}…
          </a>
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] items-center rounded-full bg-base text-lightBg font-details text-label-ui px-6 hover:bg-signal-700 transition-colors duration-[var(--duration-fast)] ease-terminal disabled:opacity-50"
      >
        {pending ? 'Executando…' : 'Executar clawback'}
      </button>
    </form>
  );
}

const inputClass =
  'mt-2 block w-full min-h-[44px] rounded-full bg-white border border-base/40 px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-700 focus-visible:ring-offset-2';
