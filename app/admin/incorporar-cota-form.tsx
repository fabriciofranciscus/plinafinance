'use client';

import { useActionState } from 'react';
import { incorporarCotaAction, type ActionResult } from './actions';

const tipoBemOptions = [
  { value: 'IMOVEL', label: 'Imóvel' },
  { value: 'VEICULO', label: 'Veículo' },
  { value: 'EQUIPAMENTO', label: 'Equipamento' },
  { value: 'SERVICO', label: 'Serviço' },
];

const caminhoOptions = [
  { value: 'A_REVENDA', label: 'A — Revenda ao usuário do bem' },
  { value: 'B_ADMINISTRADORA', label: 'B — Liquidação administradora' },
  { value: 'C_PRAZO_GRUPO', label: 'C — Prazo de grupo' },
];

export function IncorporarCotaForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    incorporarCotaAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Tipo de bem">
          <select name="tipoBem" defaultValue="IMOVEL" required className={selectClass}>
            {tipoBemOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Caminho previsto">
          <select
            name="caminhoPrevisto"
            defaultValue="A_REVENDA"
            required
            className={selectClass}
          >
            {caminhoOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Administradora">
          <input
            type="text"
            name="administradora"
            required
            placeholder="Ex: Porto Real Consórcios"
            className={inputClass}
          />
        </Field>
        <Field label="Localização aproximada">
          <input
            type="text"
            name="localizacaoAprox"
            placeholder="Ex: São Paulo - SP"
            className={inputClass}
          />
        </Field>
        <Field label="Valor da carta (BRL)">
          <input
            type="number"
            name="valorCarta"
            step="0.01"
            min="0"
            required
            placeholder="250000.00"
            className={inputClass + ' font-mono'}
          />
        </Field>
        <Field label="Deságio aquisição (0–1)">
          <input
            type="number"
            name="desagioAquisicao"
            step="0.0001"
            min="0"
            max="1"
            required
            placeholder="0.18"
            className={inputClass + ' font-mono'}
          />
        </Field>
        <Field label="Deságio revenda (opcional)">
          <input
            type="number"
            name="desagioRevenda"
            step="0.0001"
            min="0"
            max="1"
            placeholder="0.10"
            className={inputClass + ' font-mono'}
          />
        </Field>
        <Field label="Prazo restante (meses)">
          <input
            type="number"
            name="prazoRestanteMeses"
            min="0"
            placeholder="18"
            className={inputClass + ' font-mono'}
          />
        </Field>
      </div>
      <Field label="Notas (interno)">
        <input
          type="text"
          name="notas"
          placeholder="Anotação operacional opcional"
          className={inputClass}
        />
      </Field>

      {state?.error && (
        <p className="font-text text-sm text-red-700">{state.error}</p>
      )}
      {state?.ok && state.txHash && (
        <p className="font-text text-sm text-base/80">
          ✓ Cota incorporada. Tx:{' '}
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
        className="bg-base text-lightBg font-details text-xs tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
      >
        {pending ? 'Emitindo on-chain…' : 'Incorporar cota + emitir PLINA-RF'}
      </button>
    </form>
  );
}

const inputClass =
  'mt-2 w-full bg-white border border-light-hairline px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const selectClass = inputClass;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </span>
      {children}
    </label>
  );
}
