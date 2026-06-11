'use client';

/**
 * Transações — trilha auditável (EventoAudit) do investidor, cada liquidação
 * verificável na Stellar Expert pelo hash. Dados reais de /api/investidor/events.
 */

import { ACAO_LABEL, MOTIVO_LABEL, explorerTx } from '../../_lib/format';
import type { PainelData, EventRow } from '../../_hooks/use-painel-data';
import { ViewHead } from './cotas';

export default function Transactions({ data }: { data: PainelData }) {
  const { events, stellarAddress, pool } = data;

  return (
    <div>
      <ViewHead
        eyebrow="Liquidação on-chain"
        title="Transações"
        lede="Aquisições, autorizações, distribuições e liquidações. Cada movimentação é verificável na Stellar Expert pelo hash da transação."
      />

      {events && events.length === 0 ? (
        <p className="font-text text-sm text-base/55 border-t border-light-hairline pt-5">
          Sem eventos registrados. Toda compra, autorização e clawback deixa
          rastro on-chain rastreável aqui.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-light-hairline">
            <thead>
              <tr className="bg-white">
                <Th>Data</Th>
                <Th>Movimentação</Th>
                <Th>Hash</Th>
                <Th right>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((e) => (
                <Row key={e.id} event={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stellarAddress && (
        <div className="flex items-center gap-2.5 mt-5 px-5 py-3.5 bg-base">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="font-mono text-[11px] text-secondaryLight/75 break-all">
            Conta {stellarAddress.slice(0, 4)}…{stellarAddress.slice(-4)} · Ativo
            PLINA-RF{pool?.issuerPubkey ? ` · issuer ${pool.issuerPubkey.slice(0, 4)}…${pool.issuerPubkey.slice(-4)}` : ''}{' '}
            · verificável na Stellar Expert
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ event }: { event: EventRow }) {
  const isClawback = event.acao === 'CLAWBACK_EXECUTADO';
  return (
    <tr
      className={`border-t border-light-hairline transition-colors hover:bg-white ${
        isClawback ? 'bg-base/[0.04]' : 'bg-lightBg'
      }`}
    >
      <td className="px-5 py-4 font-mono text-[11px] text-base/65 whitespace-nowrap">
        {new Date(event.criadoEm).toLocaleString('pt-BR', { hour12: false })}
      </td>
      <td className="px-5 py-4">
        <div
          className={`font-text text-sm text-base ${isClawback ? 'font-semibold' : ''}`}
        >
          {ACAO_LABEL[event.acao] ?? event.acao}
        </div>
        {event.motivoClawback && (
          <div className="font-text text-xs text-base/65 mt-1">
            Motivo:{' '}
            <span className="font-mono">
              {MOTIVO_LABEL[event.motivoClawback] ?? event.motivoClawback}
            </span>
            {event.fundamentoUrl && (
              <>
                {' · '}
                <a
                  href={event.fundamentoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-base/30 hover:decoration-primary"
                >
                  fundamento jurídico
                </a>
              </>
            )}
          </div>
        )}
        {amountOf(event.payload) && (
          <div className="font-mono text-[11px] text-base/55 mt-1">
            {amountOf(event.payload)} PLINARF
          </div>
        )}
      </td>
      <td className="px-5 py-4">
        {event.stellarTxHash ? (
          <a
            href={explorerTx(event.stellarTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-primary-deep hover:text-primary"
          >
            {event.stellarTxHash.slice(0, 8)}… ↗
          </a>
        ) : (
          <span className="font-mono text-[11px] text-base/35">—</span>
        )}
      </td>
      <td className="px-5 py-4 text-right">
        <span className="font-details text-[9px] font-bold tracking-[0.14em] uppercase text-base/55">
          {event.stellarTxHash ? 'Confirmado' : 'Registrado'}
        </span>
      </td>
    </tr>
  );
}

function amountOf(payload: Record<string, unknown> | null): string | null {
  if (payload && typeof payload === 'object' && 'amount' in payload) {
    return String(payload.amount);
  }
  return null;
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`font-details text-[9px] font-bold tracking-[0.18em] uppercase text-base/55 px-5 py-3.5 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
