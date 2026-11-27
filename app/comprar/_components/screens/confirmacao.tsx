import Link from 'next/link';
import type { CessaoData, ConfirmacaoData, CotaResumo, ReservaData } from '../../_types';
import { BRL, valorRevenda } from '../../_lib/glossary';
import { txExplorerUrl } from '@/lib/stellar/explorer';
import { FaixaContexto } from '../shell/faixa-contexto';

function explorerTx(hash: string) {
  return txExplorerUrl(hash);
}

export function ConfirmacaoScreen({
  cota,
  reserva,
  cessao,
  confirmacao,
  confirming,
  onConfirmar,
  erro,
}: {
  cota: CotaResumo | null;
  reserva: ReservaData | null;
  cessao: CessaoData | null;
  confirmacao: ConfirmacaoData | null;
  confirming: boolean;
  onConfirmar: () => void;
  erro?: React.ReactNode;
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
          A cessão está assinada e registrada na rede de testes. Confirme para
          registrar a transferência de titularidade, que depende da aprovação da
          administradora.
        </p>

        <FaixaContexto cota={cota} reserva={reserva} />

        {cessao && (
          <p className="mt-6 font-mono text-[11px] text-base/65">
            Cessão {cessao.cessaoCompradorId.slice(0, 12)}… · hash{' '}
            {cessao.hashDocumento.slice(0, 10)}… · tx{' '}
            <a href={explorerTx(cessao.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-primary-deep underline hover:text-base">
              {cessao.txHash.slice(0, 8)}…
            </a>
          </p>
        )}

        <button
          onClick={onConfirmar}
          disabled={confirming}
          className="mt-8 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {confirming ? 'Confirmando…' : 'Confirmar transferência →'}
        </button>
        {erro}
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
          Sua cessão está assinada e a reserva registrada. A transferência de
          titularidade depende da aprovação da administradora. Valor a pagar:{' '}
          {BRL.format(Number(confirmacao.valorRealizado))}.
        </p>

        <FaixaContexto cota={cota} reserva={reserva} semValorAPagar />
        {reserva && (
          <p className="mt-6 font-mono text-[11px] text-base/65">
            Prova on-chain da reserva:{' '}
            <a
              href={explorerTx(reserva.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center text-primary-deep underline hover:text-base"
            >
              {reserva.txHash.slice(0, 10)}… ↗
            </a>
          </p>
        )}
        {erro}
      </div>
    );
  }

  // Realizada: alinhada à esquerda como os outros estados, sem o círculo de celebração (AP-5 C8; D1 do Atlas).
  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        05 // Transferência
      </p>
      <h1 className="mt-3 font-title text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-base">
        Cessão registrada na rede de testes
      </h1>
      <p className="mt-4 max-w-prose font-text text-base text-base/80 leading-relaxed">
        A transferência de titularidade depende da aprovação da administradora.
      </p>

      {cota && (
        <div className="mt-8 grid max-w-xl grid-cols-1 gap-px border border-light-hairline bg-base/10 text-left sm:grid-cols-3">
          <Stat k="Carta de crédito" v={BRL.format(cota.valorCarta)} />
          <Stat k="Valor a pagar" v={BRL.format(paga)} />
          <Stat k="Diferença para o valor de face" v={BRL.format(economia)} accent />
        </div>
      )}

      {cota && (
        <p className="mt-3 max-w-xl font-text text-xs text-base/70 leading-relaxed">
          Nesta fase, só são aceitas cotas quitadas (sem parcelas restantes).
        </p>
      )}

      <div className="mt-8 max-w-xl border border-light-hairline p-4">
        <h2 className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 mb-2">
          Próximos passos
        </h2>
        <ul className="space-y-1.5 font-text text-sm text-base/75">
          <li>→ Contate a administradora para a transferência de titularidade.</li>
          <li>→ Guarde a confirmação da cessão para seus registros.</li>
          <li>→ Baixe o documento de cessão para seus registros.</li>
        </ul>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {reserva && (
          <Link
            href={`/comprar/${reserva.reservaId}/comprovante`}
            className="inline-flex min-h-[44px] items-center bg-base text-white px-6 py-3 font-details text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors"
          >
            Ver comprovante →
          </Link>
        )}
        {confirmacao.txHash && (
          <a
            href={explorerTx(confirmacao.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center border border-base/30 text-base px-6 py-3 font-details text-[10px] uppercase tracking-[0.2em] hover:bg-base/5 transition-colors"
          >
            Verificar on-chain ↗
          </a>
        )}
      </div>

      {/* Provas, uma por linha, com os textos que já existem para cada uma (reserva e cessão). */}
      {(reserva || cessao) && (
        <div className="mt-6 space-y-1 font-mono text-[11px] text-base/65">
          {reserva && (
            <p>
              Prova on-chain da reserva:{' '}
              <a href={explorerTx(reserva.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-primary-deep underline hover:text-base">
                {reserva.txHash.slice(0, 10)}… ↗
              </a>
            </p>
          )}
          {cessao && (
            <p>
              Cessão {cessao.cessaoCompradorId.slice(0, 12)}… · hash {cessao.hashDocumento.slice(0, 10)}… · tx{' '}
              <a href={explorerTx(cessao.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-primary-deep underline hover:text-base">
                {cessao.txHash.slice(0, 8)}…
              </a>
            </p>
          )}
        </div>
      )}
      {erro}
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-white px-4 py-4">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
        {k}
      </p>
      <p className={`mt-1 font-mono text-sm ${accent ? 'text-primary-deep' : 'text-base'}`}>
        {v}
      </p>
    </div>
  );
}
