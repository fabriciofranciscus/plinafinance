/**
 * Escrituração e reconciliação do swap de subscrição (N1).
 *
 * `escriturarSwap` é o commit de domínio DEPOIS da tx on-chain (usado pelo /swap/submit e pelo
 * reconciliador). `reconciliarSwapsOrfaos` resolve reservas órfãs (XDR reservada, sem `consumedAt`)
 * sem esperar o investidor, com a prova pela CONTA DO INVESTIDOR (`situacaoEnvelopeSwap`, Estela):
 *   - ENTROU com sucesso → escritura;
 *   - ENTROU com falha, ou S consumida por OUTRA tx do investidor → a nossa não emitiu: libera;
 *   - S livre e a rede já passou de maxTime + espera (10 min) → libera POR TEMPO e o hash entra numa vigia
 *     de 24 h (sucesso on-chain depois → escritura + alerta);
 *   - AGUARDANDO → consulta depois; INDETERMINADO ou erro → fica órfã (gate do NAV fechado), operador.
 * Reserva sem o XDR guardado (anterior à migration) usa só o hash: sucesso → escritura, falha → libera,
 * senão fica para o operador (sem prova de não-entrada não libera).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { incrementarHolding } from './holdings';
import { registrarMovimentoFundo } from './razao-fundo';
import { valorLiquidoDaCotacao } from './regras-swap';
import { assetCodeForClasse, classeOrDefault } from '../stellar/classes';
import { fetchTransactionByHash } from '../stellar/transactions';
import { situacaoEnvelopeSwap } from '../stellar/orfa-swap';

/**
 * A liberação por TEMPO exige duas varreduras seguidas vendo a sequence livre depois do prazo, com este
 * intervalo mínimo entre elas: um nó do Horizon atrasado mais que a espera não decide sozinho (Argus a).
 */
export const INTERVALO_MIN_ENTRE_VARREDURAS_MS = 5 * 60_000;

/** Quantos hashes liberados por tempo a vigia consulta por execução (~0,45 s cada; a rota tem 60 s). */
export const VIGIA_LOTE = 50;

/** Janela da vigia dos hashes liberados por tempo. */
export const VIGIA_LIBERADAS_MS = 24 * 3600_000;

export interface EscriturarSwapInput {
  quote: { id: string; investidorId: string; fromAmount: Prisma.Decimal; fee?: string | null; classe: 'SENIOR' | 'SUBORDINADA' | null };
  /** PLINARF emitido (quote.plinarfAmount, 7 casas). */
  plinarfAmount: string;
  finalHash: string;
  orderId: string;
  /** Privy do investidor (rastreabilidade); nulo no reconciliador sem sessão. */
  privyId?: string | null;
  operador?: string;
}

export async function escriturarSwap(input: EscriturarSwapInput): Promise<void> {
  const { quote, plinarfAmount, finalHash, orderId } = input;
  const classe = classeOrDefault(quote.classe);
  await db.$transaction(async (tx) => {
    const consumed = await tx.quote.updateMany({
      where: { id: quote.id, consumedAt: null },
      data: { consumedAt: new Date(), consumedTxHash: finalHash },
    });
    if (consumed.count !== 1) {
      throw new Error('quote consumido concorrentemente — abortando');
    }
    await tx.investidor.update({
      where: { id: quote.investidorId },
      data: { saldoEsperado: { increment: new Prisma.Decimal(plinarfAmount) } },
    });
    await incrementarHolding(tx, {
      investidorId: quote.investidorId,
      classe,
      amount: plinarfAmount,
      txHash: finalHash,
    });
    // E2-5: o valor LÍQUIDO integralizado entra no caixa do fundo (numerador do NAV) junto com os q
    // tokens emitidos — senão a subscrição dilui todos.
    await registrarMovimentoFundo(tx, {
      tipo: 'SUBSCRICAO',
      valorBrl: valorLiquidoDaCotacao(quote),
      tokens: plinarfAmount,
      chave: `subscricao:${quote.id}`,
      quoteId: quote.id,
      refHash: finalHash,
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'SWAP_EXECUTADO',
        operador: input.operador ?? 'investidor-self-service',
        investidorId: quote.investidorId,
        privyId: input.privyId ?? null,
        stellarTxHash: finalHash,
        payloadJson: {
          quoteId: quote.id,
          orderId,
          amount: plinarfAmount,
          classe,
          assetCode: assetCodeForClasse(classe),
          mock: false,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Libera a reserva (só desta XDR e só enquanto não consumida). `porTempo` guarda o hash liberado na vigia
 * de 24 h: a liberação por tempo não prova que a tx não entrou, só que a rede passou do prazo dela.
 */
export function liberarReservaDoSwap(
  quoteId: string,
  xdrHash: string,
  opts: { porTempo?: { txHash: string } } = {},
) {
  return db.quote.updateMany({
    where: { id: quoteId, submitXdrHash: xdrHash, consumedAt: null },
    data: {
      submitXdrHash: null,
      submitTxHash: null,
      submitMaxTime: null,
      submitXdr: null,
      livreExpiradaVistaEm: null,
      ...(opts.porTempo
        ? { liberadaTxHash: opts.porTempo.txHash, liberadaPorTempoEm: new Date() }
        : {}),
    },
  });
}

export interface ResultadoReconciliacao {
  escriturados: number;
  /** Liberadas com prova (falha on-chain ou S consumida por outra tx) ou por tempo. */
  liberados: number;
  /** Dentro do prazo (ou da espera depois dele): consulta de novo depois. */
  aguardando: number;
  /** Sem prova (INDETERMINADO, ou sem XDR e fora da chain): fica órfã, gate do NAV fechado, operador. */
  vencidasSemProva: number;
  /** Reservas sem submitTxHash (anteriores à migration): precisam do operador. */
  semHash: number;
  /** Vigia de 24 h: tx liberada por tempo que entrou depois (escriturada + alerta). */
  vigiaEscrituradas: number;
  /** Vigia: tx liberada por tempo entrou, mas o quote já foi consumido por OUTRA tx (emissão dupla). */
  vigiaConflitos: number;
  /** Hashes liberados por tempo ainda na janela de 24 h que ficaram para a próxima execução (só contagem). */
  vigiaRestantes: number;
  /** Ids (internos) dos quotes com conflito NOVO (ainda sem alerta): para o e-mail; a rota não os devolve. */
  conflitoQuoteIds: string[];
  erros: number;
}

type Orfa = {
  id: string;
  investidorId: string;
  fromAmount: Prisma.Decimal;
  fee: string;
  classe: 'SENIOR' | 'SUBORDINADA' | null;
  plinarfAmount: Prisma.Decimal | null;
  submitXdrHash: string | null;
  submitTxHash: string | null;
  submitMaxTime: Date | null;
  submitXdr: string | null;
  livreExpiradaVistaEm?: Date | null;
  onRampOrder: { id: string } | null;
};

async function escriturarOrfa(q: Orfa, hash: string, operador: string): Promise<boolean> {
  if (!q.plinarfAmount || !q.onRampOrder) return false; // sem preço ou sem ordem: não escritura às cegas
  await escriturarSwap({
    quote: { id: q.id, investidorId: q.investidorId, fromAmount: q.fromAmount, fee: q.fee, classe: q.classe },
    plinarfAmount: new Prisma.Decimal(q.plinarfAmount).toFixed(7),
    finalHash: hash,
    orderId: q.onRampOrder.id,
    operador,
  });
  return true;
}

export async function reconciliarSwapsOrfaos(
  opts: { agora?: number } = {},
): Promise<ResultadoReconciliacao> {
  const agora = opts.agora ?? Date.now();
  const agoraSec = Math.floor(agora / 1000);
  const r: ResultadoReconciliacao = {
    escriturados: 0, liberados: 0, aguardando: 0, vencidasSemProva: 0, semHash: 0,
    vigiaEscrituradas: 0, vigiaConflitos: 0, vigiaRestantes: 0, conflitoQuoteIds: [], erros: 0,
  };

  const orfas = (await db.quote.findMany({
    where: { submitXdrHash: { not: null }, consumedAt: null, plinarfAmount: { not: null } },
    select: {
      id: true, investidorId: true, fromAmount: true, fee: true, classe: true, plinarfAmount: true,
      submitXdrHash: true, submitTxHash: true, submitMaxTime: true, submitXdr: true,
      livreExpiradaVistaEm: true,
      onRampOrder: { select: { id: true } },
    },
  })) as Orfa[];

  for (const q of orfas) {
    if (!q.submitXdrHash || (!q.submitTxHash && !q.submitXdr)) {
      r.semHash++;
      continue;
    }
    try {
      if (q.submitXdr) {
        // Prova pela conta do INVESTIDOR (Estela, contrato n1-orfa-prova). Erro do Horizon propaga = sem decisão.
        const sit = await situacaoEnvelopeSwap(q.submitXdr);
        if (sit.status === 'ENTROU' && sit.successful) {
          if (await escriturarOrfa(q, sit.hash, 'reconciliador-swap')) r.escriturados++;
          else r.erros++;
        } else if (sit.status === 'ENTROU' || sit.status === 'OUTRA_TX') {
          await liberarReservaDoSwap(q.id, q.submitXdrHash); // a nossa não emitiu: prova positiva
          r.liberados++;
        } else if (sit.status === 'LIVRE_EXPIRADA') {
          // S livre e a rede passou de maxTime + espera. Um nó atrasado pode dizer isto de uma tx que entrou:
          // só libera na 2ª varredura seguida, ≥ 5 min depois da 1ª; a 1ª só marca. Vigia de 24 h depois.
          const vista = q.livreExpiradaVistaEm;
          if (!vista) {
            await db.quote.updateMany({
              where: { id: q.id, submitXdrHash: q.submitXdrHash, consumedAt: null },
              data: { livreExpiradaVistaEm: new Date(agora) },
            });
            r.aguardando++;
          } else if (agora - vista.getTime() >= INTERVALO_MIN_ENTRE_VARREDURAS_MS) {
            await liberarReservaDoSwap(q.id, q.submitXdrHash, { porTempo: { txHash: q.submitTxHash ?? '' } });
            r.liberados++;
          } else {
            r.aguardando++; // 2ª varredura cedo demais (disparo manual em sequência): não conta
          }
        } else if (sit.status === 'AGUARDANDO') {
          r.aguardando++;
        } else {
          r.vencidasSemProva++; // INDETERMINADO: operador (runbook)
        }
        // A marca da 1ª varredura só vale enquanto o estado seguir LIVRE_EXPIRADA: qualquer outro resultado a apaga.
        if (sit.status !== 'LIVRE_EXPIRADA' && q.livreExpiradaVistaEm && sit.status !== 'ENTROU' && sit.status !== 'OUTRA_TX') {
          await db.quote.updateMany({
            where: { id: q.id, submitXdrHash: q.submitXdrHash, consumedAt: null },
            data: { livreExpiradaVistaEm: null },
          });
        }
        continue;
      }
      // Reserva sem o XDR guardado (anterior à migration): só o hash.
      const onchain = await fetchTransactionByHash(q.submitTxHash as string);
      if (onchain?.successful) {
        if (await escriturarOrfa(q, onchain.hash, 'reconciliador-swap')) r.escriturados++;
        else r.erros++;
      } else if (onchain) {
        await liberarReservaDoSwap(q.id, q.submitXdrHash); // falhou on-chain: prova positiva
        r.liberados++;
      } else {
        const maxSec = q.submitMaxTime ? Math.floor(q.submitMaxTime.getTime() / 1000) : 0;
        if (maxSec && agoraSec <= maxSec) r.aguardando++;
        else r.vencidasSemProva++; // sem prova de não-entrada: NÃO libera
      }
    } catch (err) {
      // Horizon fora ou commit falhou: mantém a reserva (o gate do NAV segue fechado) e conta o erro.
      console.error('[swap-reconciliacao] reserva', q.id, (err as { name?: string })?.name ?? 'erro');
      r.erros++;
    }
  }

  // Vigia de 24 h: hashes liberados por TEMPO. Sucesso on-chain depois → escritura + alerta.
  const doVigia = {
    liberadaTxHash: { not: null },
    liberadaPorTempoEm: { gte: new Date(agora - VIGIA_LIBERADAS_MS) },
  };
  const totalVigia = await db.quote.count({ where: doVigia });
  // Lote com RODÍZIO: nunca consultadas primeiro, depois as consultadas há mais tempo — com mais hashes que o
  // lote, "só as mais antigas" deixaria as novas sem consulta até expirarem.
  const vigiadas = await db.quote.findMany({
    where: doVigia,
    orderBy: [{ vigiaConsultadaEm: { sort: 'asc', nulls: 'first' } }, { liberadaPorTempoEm: 'asc' }],
    take: VIGIA_LOTE,
    select: {
      id: true, investidorId: true, fromAmount: true, fee: true, classe: true, plinarfAmount: true,
      liberadaTxHash: true, consumedAt: true, consumedTxHash: true, conflitoAlertadoEm: true,
      onRampOrder: { select: { id: true } },
    },
  });
  for (const v of vigiadas) {
    if (!v.liberadaTxHash) continue;
    if (v.consumedTxHash === v.liberadaTxHash) continue; // já escriturada
    try {
      const onchain = await fetchTransactionByHash(v.liberadaTxHash);
      if (!onchain?.successful) continue;
      if (v.consumedAt) {
        // O quote já foi consumido por OUTRA tx e a liberada também entrou: emissão dupla. Sem escriturar. O
        // alerta sai UMA vez por quote (dedupe por conflitoAlertadoEm), senão a cada varredura por 24 h.
        if (!v.conflitoAlertadoEm) {
          console.error('[swap-reconciliacao] ALERTA vigia: tx liberada por tempo entrou e o quote já tem outra tx', v.id);
          await db.quote.updateMany({ where: { id: v.id, conflitoAlertadoEm: null }, data: { conflitoAlertadoEm: new Date() } });
          r.vigiaConflitos++;
          r.conflitoQuoteIds.push(v.id);
        }
        continue;
      }
      const ok = await escriturarOrfa(
        { ...v, submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null } as Orfa,
        onchain.hash,
        'reconciliador-swap-vigia',
      );
      if (ok) {
        console.error('[swap-reconciliacao] ALERTA vigia: tx liberada por tempo entrou on-chain e foi escriturada', v.id);
        r.vigiaEscrituradas++;
      } else {
        r.erros++;
      }
    } catch (err) {
      console.error('[swap-reconciliacao] vigia', v.id, (err as { name?: string })?.name ?? 'erro');
      r.erros++;
    }
  }
  r.vigiaRestantes = Math.max(0, totalVigia - vigiadas.length);
  if (vigiadas.length > 0) {
    // Carimba o lote inteiro (inclusive os já escriturados e os com erro): o rodízio avança.
    await db.quote.updateMany({
      where: { id: { in: vigiadas.map((v) => v.id) } },
      data: { vigiaConsultadaEm: new Date(agora) },
    });
  }
  return r;
}
