'use client';

import { useEffect, useRef, useState } from 'react';
import { ClawbackForm } from './clawback-form';

/** Dados que a página (servidor) já tem de cada investidor, serializados como hoje (nada extra vai ao cliente). */
export interface InvestidorAdmin {
  id: string;
  email: string;
  publicKey: string;
  /** Link do explorer da conta, montado no servidor. */
  explorerUrl: string;
  /** Saldo esperado já formatado (o mesmo texto que o formulário recebe). */
  saldoEsperado: string;
  status: string;
}

const ROTULO = 'font-details text-label-ui text-base/70';
const abreviar = (chave: string) => (chave.length > 12 ? `${chave.slice(0, 5)}…${chave.slice(-4)}` : chave);

/**
 * Painel Investidores (U1-11, PR 2): lista e detalhe, um alvo por vez; o clawback fica dentro do detalhe, fechado até a
 * abertura explícita. Os detalhes de todos os investidores ficam montados (os não selecionados recebem `hidden`: saem do
 * foco e da árvore acessível): assim, trocar de alvo não apaga o rascunho nem o resultado de um clawback em andamento.
 * Só apresentação: nada aqui chama a action; o formulário é o mesmo de antes.
 */
export function InvestidoresPainel({ investidores }: { investidores: InvestidorAdmin[] }) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  // Para onde levar o foco DEPOIS da próxima pintura (o detalhe ainda está `hidden` até o commit).
  const proximoFoco = useRef<{ onde: 'detalhe' | 'item'; id: string } | null>(null);

  function selecionar(id: string) {
    proximoFoco.current = { onde: 'detalhe', id };
    setSelecionado(id);
  }

  function voltar() {
    if (selecionado) proximoFoco.current = { onde: 'item', id: selecionado };
    setSelecionado(null);
  }

  useEffect(() => {
    const alvo = proximoFoco.current;
    if (!alvo) return;
    proximoFoco.current = null;
    const id = CSS.escape(alvo.id);
    if (alvo.onde === 'detalhe') {
      raiz.current?.querySelector<HTMLElement>(`[data-detalhe="${id}"] h3`)?.focus();
    } else {
      const itens = [...(raiz.current?.querySelectorAll<HTMLElement>(`[data-item="${id}"]`) ?? [])];
      // A lista visível é a da tabela (≥1024) ou a do celular; sem layout (testes), o primeiro serve.
      (itens.find((el) => el.getClientRects().length > 0) ?? itens[0])?.focus();
    }
  }, [selecionado]);

  return (
    <div ref={raiz} className="lg:grid lg:grid-cols-12 lg:gap-8">
      <div className={`lg:col-span-7 ${selecionado ? 'hidden lg:block' : ''}`}>
        {/* Desktop: tabela semântica */}
        <table data-testid="lista-tabela" className="hidden lg:table w-full table-fixed font-text text-sm">
          <caption className="sr-only">Investidores</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>Email</th>
              <th scope="col" className={`${ROTULO} py-2 pr-3 font-normal`}>Public key</th>
              <th scope="col" className={`${ROTULO} py-2 font-normal`}>Saldo esperado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base/12">
            {investidores.map((inv) => (
              <tr key={inv.id} className={`align-top ${inv.id === selecionado ? 'bg-document-grey/60' : ''}`}>
                <td className="py-3 pr-3 break-all">
                  <a
                    href={`#investidor-${inv.id}`}
                    data-item={inv.id}
                    aria-current={inv.id === selecionado ? 'true' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      selecionar(inv.id);
                    }}
                    className={`inline-flex min-h-[44px] items-center underline text-signal-700 ${inv.id === selecionado ? 'font-semibold' : ''}`}
                  >
                    {inv.email}
                  </a>
                </td>
                <td className="py-3 pr-3 font-mono text-xs">{abreviar(inv.publicKey)}</td>
                <td className="py-3 font-mono">
                  {inv.saldoEsperado}
                  <span className="block font-mono text-xs text-base/70">{inv.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Celular e tablet: alvo de 72 px por investidor */}
        <ul data-testid="lista-mobile" className="lg:hidden divide-y divide-base/12 border border-light-hairline rounded-panel overflow-hidden bg-white">
          {investidores.map((inv) => (
            <li key={inv.id}>
              <button
                type="button"
                data-item={inv.id}
                onClick={() => selecionar(inv.id)}
                className="block w-full min-h-[72px] px-4 py-3 text-left"
              >
                <span className="block font-text text-sm font-semibold break-all">{inv.email}</span>
                <span className="block font-mono text-xs text-base/70 mt-1">
                  {abreviar(inv.publicKey)} · {inv.saldoEsperado}
                </span>
                <span className="block font-mono text-xs text-base/70 mt-1">{inv.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={`lg:col-span-5 ${selecionado ? '' : 'hidden lg:block'}`}>
        {selecionado === null && <p className="font-text text-body-small text-base/70">Escolha um investidor na lista.</p>}
        {investidores.map((inv) => (
          <div key={inv.id} data-detalhe={inv.id} hidden={inv.id !== selecionado} className="rounded-panel border border-light-hairline bg-white p-4 md:p-6 space-y-4 shadow-raised">
            <button type="button" onClick={voltar} className={`lg:hidden min-h-[44px] -ml-1 ${ROTULO} underline underline-offset-4`}>
              ← Investidores
            </button>
            <h3 tabIndex={-1} className="font-title text-section-title break-all">
              {inv.email}
            </h3>
            <dl className="space-y-3 font-text text-body-ui">
              <div>
                <dt className={ROTULO}>Public key</dt>
                <dd>
                  <a
                    href={inv.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center font-mono text-xs break-all underline"
                  >
                    {inv.publicKey}
                  </a>
                </dd>
              </div>
              <div>
                <dt className={ROTULO}>Saldo esperado</dt>
                <dd className="font-mono">{inv.saldoEsperado}</dd>
                <dd className="font-mono text-xs text-base/70">{inv.status}</dd>
              </div>
            </dl>
            <details className="border-t border-light-hairline pt-3">
              <summary className="min-h-[44px] flex items-center cursor-pointer font-details text-label-ui">
                Clawback
              </summary>
              <ClawbackForm investidorId={inv.id} investidorEmail={inv.email} saldoEsperado={inv.saldoEsperado} />
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
