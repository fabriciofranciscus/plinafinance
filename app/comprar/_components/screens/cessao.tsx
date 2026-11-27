import type { CessaoData, CotaResumo, ReservaData } from '../../_types';
import type { PessoaState } from '@/components/PessoaProvider';
import { FaixaContexto } from '../shell/faixa-contexto';

const labelCls =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/70';

export function CessaoScreen({
  pessoa,
  cota,
  reserva,
  signing,
  onAssinar,
}: {
  pessoa: PessoaState;
  cota: CotaResumo | null;
  reserva: ReservaData | null;
  cessao: CessaoData | null;
  signing: boolean;
  onAssinar: () => void;
}) {
  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        04 // Cessão digital · assinatura
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Modelo de contrato de cessão (demonstração).
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Simulação na rede de testes: nenhum contrato real é assinado. Plina
        Finance → {pessoa.nome ?? 'comprador'}.
      </p>

      <FaixaContexto cota={cota} reserva={reserva} />

      <div data-testid="documento-cessao" className="mt-8 border border-light-hairline bg-lightBg/40 p-6">
        <p className={labelCls}>Documento</p>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field k="Nome" v={pessoa.nome ?? '—'} />
          <Field k="E-mail" v={pessoa.email ?? '—'} />
        </dl>
        {reserva && (
          <p className="mt-4 font-mono text-[11px] text-base/70">
            Reserva {reserva.reservaId.slice(0, 12)}… · prova on-chain{' '}
            {reserva.txHash.slice(0, 8)}…
          </p>
        )}
      </div>

      <button
        onClick={onAssinar}
        disabled={signing}
        className="mt-8 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-60 disabled:cursor-wait"
      >
        {signing ? 'Simulando…' : 'Simular assinatura →'}
      </button>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className={labelCls}>{k}</dt>
      <dd className="mt-1 break-all font-text text-sm text-base">{v}</dd>
    </div>
  );
}
