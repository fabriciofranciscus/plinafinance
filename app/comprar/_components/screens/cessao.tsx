import type { CessaoData, CotaResumo, ReservaData } from '../../_types';
import type { PessoaState } from '@/components/PessoaProvider';
import { BRL, TIPO_LABEL, valorRevenda } from '../../_lib/glossary';

const labelCls =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/60';

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
  const paga = cota ? valorRevenda(cota.valorCarta, cota.desagioRevenda) : 0;

  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        04 // Cessão digital · assinatura
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Contrato de cessão de direitos creditórios.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Assinatura com e-CPF · hash do documento registrado on-chain. Plina
        Finance → {pessoa.nome ?? 'comprador'}.
      </p>

      <div className="mt-8 border border-light-hairline bg-lightBg/40 p-6">
        <p className={labelCls}>Documento</p>
        <p className="mt-2 font-title text-lg font-semibold text-base">
          Contrato de Cessão de Direitos Creditórios
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field k="Nome" v={pessoa.nome ?? '—'} />
          <Field k="E-mail" v={pessoa.email ?? '—'} />
          {cota && (
            <>
              <Field k="Cota" v={`${TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem}`} />
              <Field k="Valor a pagar" v={BRL.format(paga)} />
            </>
          )}
        </div>
        {reserva && (
          <p className="mt-4 font-mono text-[11px] text-base/55">
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
        {signing ? 'Assinando…' : 'Assinar com e-CPF →'}
      </button>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60">
        {k}
      </span>
      <p className="mt-1 border border-light-hairline bg-white px-3 py-2.5 font-text text-sm text-base/80 break-all">
        {v}
      </p>
    </div>
  );
}
