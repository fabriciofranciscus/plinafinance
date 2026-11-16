'use client';

import { useActionState, useEffect, useState } from 'react';
import { executarClawbackAction, type ActionResult } from './actions';

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
    <form action={formAction} className="space-y-3 bg-lightBg/40 p-4 border border-light-hairline">
      <input type="hidden" name="investidorId" value={investidorId} />
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        Clawback · política pública 4 hipóteses
      </p>
      <p className="font-text text-xs text-base/70">
        Alvo: {investidorEmail} · Saldo esperado: <span className="font-mono">{saldoEsperado}</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            Quantidade
          </span>
          <input
            type="number"
            name="amount"
            step="0.0000001"
            min="0.0000001"
            required
            placeholder="100"
            className={inputClass + ' font-mono'}
          />
        </label>
        <label className="block">
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
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
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
            URL fundamento
          </span>
          <input
            type="url"
            name="fundamentoUrl"
            required
            placeholder="https://…/decisao.pdf"
            className={inputClass + ' font-mono text-xs'}
          />
        </label>
      </div>

      {state?.error && (
        <p className="font-text text-sm text-red-700">{state.error}</p>
      )}
      {state?.ok && state.txHash && (
        <p className="font-text text-sm text-base/80">
          ✓ Clawback executado. Tx:{' '}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${state.txHash}`}
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
        className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-4 py-2 hover:bg-primary-deep transition-colors disabled:opacity-50"
      >
        {pending ? 'Executando…' : 'Executar clawback'}
      </button>
    </form>
  );
}

const inputClass =
  'mt-2 w-full bg-white border border-light-hairline px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
