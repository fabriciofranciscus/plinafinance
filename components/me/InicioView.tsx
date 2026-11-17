/**
 * /inicio (spec de UX da Íris, §2): o que fazer agora, quanto tenho, o que anda.
 * Apresentação pura: recebe o resumo pronto. Números só são formatados aqui.
 */

import Link from 'next/link';
import { proximaAcao, linhaAndamento, idCurtoSolicitacao } from '@/lib/me/proxima-acao';
import { ROTULO_TIPO_BEM, STATUS_ABERTOS } from '@/lib/me/vocabulario';
import { explorerTx, fmtBrl, fmtBrlInteiro, fmtDataHora, fmtNavToken, fmtTokens, nomeExibivel } from '@/lib/me/formato';
import type { OperacaoPendente, ResumoDaConta } from '@/lib/me/tipos';
import type { FaseOrdemPendente } from '@/lib/services/ordem-pendente';

export type EstadoInicio =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; onTentarDeNovo: () => void }
  | { tipo: 'ok'; resumo: ResumoDaConta };

const BTN_PRIMARIO =
  'inline-flex min-h-[44px] items-center justify-center bg-lightBg text-base font-details text-[10px] tracking-[0.2em] uppercase px-5 py-3 hover:bg-white transition-colors';
const BTN_SECUNDARIO =
  'inline-flex min-h-[44px] items-center justify-center border border-base text-base font-details text-[10px] tracking-[0.2em] uppercase px-5 py-3 hover:bg-document-grey/60 transition-colors';
const LINK = 'inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-primary-deep';
const SITUACAO_OPERACAO: Record<OperacaoPendente['situacao'], string> = {
  em_conferencia: 'Em conferência',
  aguardando_assinatura: 'Aguardando sua assinatura',
};
/** A-07: a entrada (compra) diz em que passo parou, em vez de "Aguardando sua assinatura" para tudo. */
const SITUACAO_FASE: Record<FaseOrdemPendente, string> = {
  aguardando_pagamento: 'Aguardando o pagamento',
  liquidando: 'Pagamento sendo confirmado',
  resgatar_tesouro: 'Falta receber o TESOURO',
  concluir_swap: 'Falta concluir a compra',
  em_conferencia: 'Em conferência',
};
/** Norma B1 (Consuelo aprovou): o valor é referência, não preço de compra ou venda. */
const APOIO_NAV =
  'Cálculo pelo custo de aquisição das cotas e pelos tokens emitidos. Não é preço garantido de compra ou venda. O valor pode mudar com emissões, resgates e realizações, e pode ficar indisponível.';
const ROTULO = 'font-details text-[10px] tracking-[0.2em] uppercase text-base/70';

export default function InicioView({ estado, exemplo = false }: { estado: EstadoInicio; exemplo?: boolean }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 md:py-14">
      {exemplo && (
        <p role="note" className="mb-6 border border-base/40 bg-document-grey/60 px-4 py-3 font-mono text-xs text-base">
          Dados de exemplo (fictícios), só para pré-visualização.
        </p>
      )}
      <Cabecalho nome={estado.tipo === 'ok' ? estado.resumo.nome : null} />

      {estado.tipo === 'carregando' && (
        <p role="status" className="mt-8 font-text text-sm text-base/70">
          Carregando…
        </p>
      )}

      {estado.tipo === 'erro' && (
        <div role="alert" className="mt-8">
          <p className="font-text text-sm text-base/80">Não foi possível carregar sua conta agora.</p>
          <button type="button" onClick={estado.onTentarDeNovo} className={`${LINK} mt-2`}>
            Tentar de novo
          </button>
        </div>
      )}

      {estado.tipo === 'ok' && <Corpo resumo={estado.resumo} />}

      <Atalhos />
    </main>
  );
}

function Cabecalho({ nome }: { nome: string | null }) {
  const n = nomeExibivel(nome);
  return (
    <header>
      <p className={ROTULO}>Início</p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight mt-2">{n ? `Olá, ${n}` : 'Sua conta'}</h1>
    </header>
  );
}

function Corpo({ resumo }: { resumo: ResumoDaConta }) {
  const acao = proximaAcao(resumo);
  const abertas = resumo.solicitacoes.filter((s) => STATUS_ABERTOS.includes(s.status));
  const investidor = resumo.papeis.includes('INVESTIDOR') && !!resumo.posicao;
  // Investidor sem saldo vê a Posição com 0,0000 (§2.5); conta nova (sem papel, sem posição) não vê o bloco.
  const mostraPosicao = investidor;
  const mostraAndamento = abertas.length > 0 || resumo.operacoesPendentes.length > 0;

  return (
    <div className="mt-8 space-y-10">
      <ProximaAcaoBloco acao={acao} />
      {(mostraPosicao || mostraAndamento) && (
        <div className="grid gap-10 lg:grid-cols-12">
          {mostraPosicao && (
            <div className={mostraAndamento ? 'lg:col-span-5' : 'lg:col-span-12'}>
              <PosicaoBloco posicao={resumo.posicao!} />
            </div>
          )}
          {mostraAndamento && (
            <div className={mostraPosicao ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <AndamentoBloco resumo={resumo} abertas={abertas} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProximaAcaoBloco({ acao }: { acao: ReturnType<typeof proximaAcao> }) {
  const escuro = acao.escuro;
  return (
    <section
      aria-labelledby="proxima-acao"
      className={escuro ? 'bg-base text-lightBg p-6 md:p-8' : 'border border-light-hairline bg-lightBg p-6 md:p-8'}
    >
      <p id="proxima-acao" className={`font-details text-[10px] tracking-[0.2em] uppercase ${escuro ? 'text-lightBg/70' : 'text-base/70'}`}>
        Próxima ação
      </p>
      <h2 className="font-title text-xl md:text-2xl font-semibold tracking-tight mt-2">{acao.titulo}</h2>
      {acao.apoio && <p className={`font-text text-sm mt-2 max-w-xl ${escuro ? 'text-lightBg/80' : 'text-base/70'}`}>{acao.apoio}</p>}

      {'botao' in acao && (
        <div className="mt-5">
          <Link href={acao.href} className={BTN_PRIMARIO}>
            {acao.botao} <span aria-hidden="true">&nbsp;→</span>
          </Link>
        </div>
      )}
      {'dois' in acao && (
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/investir" className={BTN_SECUNDARIO}>
            Investir (testnet)
          </Link>
          <Link href="/vender" className={BTN_SECUNDARIO}>
            Vender uma cota
          </Link>
        </div>
      )}
      {(acao.caso === 5) && acao.href && (
        <p className="mt-3">
          <Link href={acao.href} className={LINK}>
            Abrir acompanhamento →
          </Link>
        </p>
      )}
    </section>
  );
}

function PosicaoBloco({ posicao }: { posicao: NonNullable<ResumoDaConta['posicao']> }) {
  const zero = Number(posicao.tokens) === 0;
  const navFora = !!posicao.navIndisponivel || posicao.navPorToken === null;
  return (
    <section aria-labelledby="posicao-titulo">
      <h2 id="posicao-titulo" className={ROTULO}>
        Posição
      </h2>
      <dl className="mt-3 divide-y divide-light-hairline border border-light-hairline bg-white lg:flex lg:divide-y-0 lg:divide-x">
        <Dado rotulo="PLINA-RF" valor={fmtTokens(posicao.tokens)} grande />
        <Dado rotulo="Valor de referência (NAV)" valor={navFora ? '—' : fmtBrl(posicao.valorPeloNav)} />
        <Dado rotulo="NAV por token" valor={navFora ? '—' : fmtNavToken(posicao.navPorToken)} />
      </dl>
      {navFora ? (
        <p role="status" className="mt-2 font-text text-xs text-base/70">
          NAV indisponível agora. O saldo em PLINA-RF não muda.
        </p>
      ) : (
        posicao.snapshotEm &&
        posicao.snapshotTxHash && (
          <p className="mt-2 font-mono text-[11px] text-base/70">
            Ledger · snapshot {fmtDataHora(posicao.snapshotEm)}{' '}
            <a
              href={explorerTx(posicao.snapshotTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Transação do snapshot no explorer, abre em nova aba"
              className="underline text-primary-deep"
            >
              ↗
            </a>
          </p>
        )
      )}
      <p className="mt-2 font-text text-xs text-base/70">{APOIO_NAV}</p>
      {zero && <p className="mt-2 font-text text-sm text-base/70">Você ainda não tem PLINA-RF.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/investir" className={BTN_SECUNDARIO}>
          Investir (testnet)
        </Link>
        {!zero && (
          <Link href="/sacar" className={BTN_SECUNDARIO}>
            Sacar (testnet)
          </Link>
        )}
      </div>
      <p className="mt-2">
        <Link href="/minha-posicao" className={LINK}>
          Ver posição completa →
        </Link>
      </p>
    </section>
  );
}

function Dado({ rotulo, valor, grande = false }: { rotulo: string; valor: string; grande?: boolean }) {
  return (
    <div className="p-4 lg:flex-1">
      <dt className={ROTULO}>{rotulo}</dt>
      <dd className={`font-mono mt-1 ${grande ? 'text-2xl' : 'text-lg'}`}>{valor}</dd>
    </div>
  );
}

function AndamentoBloco({ resumo, abertas }: { resumo: ResumoDaConta; abertas: ResumoDaConta['solicitacoes'] }) {
  return (
    <section aria-labelledby="andamento-titulo">
      <h2 id="andamento-titulo" className={ROTULO}>
        Em andamento
      </h2>
      <ul className="mt-3 divide-y divide-light-hairline border border-light-hairline bg-white">
        {abertas.map((s) => {
          const l = linhaAndamento(s);
          return (
            <li key={s.id} className="p-4">
              <p className="font-mono text-xs text-base/70">Solicitação #{idCurtoSolicitacao(s.id)}</p>
              <p className="font-text text-sm font-semibold mt-1">{l.etapa}</p>
              {s.valorCarta && (
                <p className="font-mono text-xs text-base/70 mt-1">
                  {s.tipoBem ? `${ROTULO_TIPO_BEM[s.tipoBem] ?? s.tipoBem} · ` : ''}carta {fmtBrlInteiro(s.valorCarta)}
                </p>
              )}
              <p className="font-text text-sm text-base/80 mt-1">{l.quemAge}</p>
              <Link href={`/vender/acompanhar/${s.id}`} className={`${LINK} mt-1`}>
                Abrir acompanhamento →
              </Link>
            </li>
          );
        })}
        {resumo.operacoesPendentes.map((o, i) => (
          <OperacaoItem key={i} op={o} />
        ))}
      </ul>
      {resumo.solicitacoes.length > 0 && (
        <p className="mt-2">
          <Link href="/vender/minhas" className={LINK}>
            Ver todas as solicitações ({resumo.solicitacoes.length}) →
          </Link>
        </p>
      )}
    </section>
  );
}

function OperacaoItem({ op }: { op: OperacaoPendente }) {
  return (
    <li className="p-4">
      <p className="font-text text-sm font-semibold">
        {op.tipo === 'entrada' ? 'Entrada no pool' : 'Saída do pool'} · <span className="font-mono">{op.valor}</span>
      </p>
      <p className="font-text text-sm text-base/80 mt-1">{op.fase ? SITUACAO_FASE[op.fase] : SITUACAO_OPERACAO[op.situacao]} (pagamento simulado)</p>
      <Link href={op.continuarEm} className={`${LINK} mt-1`}>
        Continuar →
      </Link>
    </li>
  );
}

function Atalhos() {
  return (
    <nav aria-label="Atalhos" className="mt-12 border-t border-light-hairline pt-6">
      <h2 className={ROTULO}>Atalhos</h2>
      <ul className="mt-2 flex flex-col md:flex-row md:flex-wrap md:gap-x-8">
        {[
          ['/historico', 'Histórico'],
          ['/pool', 'Pool e valor do token'],
          ['/cotas', 'Cotas do pool'],
          ['/politica-clawback', 'Política de clawback (revogação de tokens, só nos casos previstos)'],
        ].map(([href, rotulo]) => (
          <li key={href}>
            <Link href={href!} className={LINK}>
              {rotulo} →
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
