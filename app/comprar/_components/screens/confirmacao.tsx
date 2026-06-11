import Link from 'next/link';
import type { CessaoData, ConfirmacaoData, CotaResumo, ReservaData } from '../../_types';
import { BRL, valorRevenda } from '../../_lib/glossary';

function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function ConfirmacaoScreen({
  cota,
  reserva,
  cessao,
  confirmacao,
  confirming,
  onConfirmar,
}: {
  cota: CotaResumo | null;
  reserva: ReservaData | null;
  cessao: CessaoData | null;
  confirmacao: ConfirmacaoData | null;
  confirming: boolean;
  onConfirmar: () => void;
}) {
  const paga = cota ? valorRevenda(cota.valorCarta, cota.desagioRevenda) : 0;
  const economia = cota ? cota.valorCarta - paga : 0;

  // Estado inicial: ainda não confirmou → resumo + botão.
  if (!confirmacao) {
    return (
      <div>
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          05 // Transferência
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
          Confirme a transferência de titularidade.
        </h1>
        <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
          A cessão está assinada e registrada on-chain. Confirme para finalizar
          a aquisição da carta de crédito.
        </p>

        {cessao && (
          <p className="mt-6 font-mono text-[11px] text-base/55">
            Cessão {cessao.cessaoCompradorId.slice(0, 12)}… · hash{' '}
            {cessao.hashDocumento.slice(0, 10)}… · tx {cessao.txHash.slice(0, 8)}…
          </p>
        )}

        <button
          onClick={onConfirmar}
          disabled={confirming}
          className="mt-8 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {confirming ? 'Confirmando…' : 'Confirmar transferência →'}
        </button>
      </div>
    );
  }

  // Pendente (flag self-realização desligada).
  if (confirmacao.status === 'PENDENTE_CONFIRMACAO') {
    return (
      <div>
        <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
          05 // Transferência
        </p>
        <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
          Aguardando confirmação.
        </h1>
        <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
          Sua cessão está assinada e a reserva registrada. A equipe Plina confirma
          a transferência de titularidade na administradora e você recebe o aviso
          por e-mail. Valor a pagar: {BRL.format(Number(confirmacao.valorRealizado))}.
        </p>
        {reserva && (
          <p className="mt-6 font-mono text-[11px] text-base/55">
            Prova on-chain da reserva:{' '}
            <a
              href={explorerTx(reserva.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-deep underline"
            >
              {reserva.txHash.slice(0, 10)}… ↗
            </a>
          </p>
        )}
      </div>
    );
  }

  // Realizada.
  return (
    <div className="text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-deep text-white text-2xl">
        ✓
      </span>
      <h1 className="mt-6 font-title text-3xl font-semibold tracking-tight text-base">
        Cessão concluída
      </h1>
      <p className="mx-auto mt-3 max-w-md font-text text-sm text-base/80">
        Você agora é titular da carta de crédito.
      </p>

      {cota && (
        <div className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-px bg-base/10 border border-light-hairline text-left">
          <Stat k="Carta de crédito" v={BRL.format(cota.valorCarta)} />
          <Stat k="Pago" v={BRL.format(paga)} />
          <Stat k="Economia" v={BRL.format(economia)} accent />
        </div>
      )}

      <div className="mx-auto mt-8 max-w-xl border border-light-hairline p-4 text-left">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-2">
          Próximos passos
        </p>
        <ul className="space-y-1.5 font-text text-sm text-base/75">
          <li>→ Contate a administradora para a transferência de titularidade.</li>
          <li>→ Utilize a carta de crédito para aquisição do bem.</li>
          <li>→ Baixe o documento de cessão para seus registros.</li>
        </ul>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {reserva && (
          <Link
            href={`/comprar/${reserva.reservaId}/comprovante`}
            className="bg-base text-white px-6 py-3 font-details text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors"
          >
            Ver comprovante →
          </Link>
        )}
        {confirmacao.txHash && (
          <a
            href={explorerTx(confirmacao.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-base/30 text-base px-6 py-3 font-details text-[10px] uppercase tracking-[0.2em] hover:bg-base/5 transition-colors"
          >
            Verificar on-chain ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-white px-4 py-4">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55">
        {k}
      </p>
      <p className={`mt-1 font-mono text-sm ${accent ? 'text-primary-deep' : 'text-base'}`}>
        {v}
      </p>
    </div>
  );
}
