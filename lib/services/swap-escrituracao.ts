/**
 * Escrituração e reconciliação do swap de subscrição (N1).
 *
 * `escriturarSwap` é o commit de domínio DEPOIS da tx on-chain (usado pelo /swap/submit e pelo
 * reconciliador). `reconciliarSwapsOrfaos` resolve reservas órfãs (XDR reservada, sem `consumedAt`)
 * sem esperar o investidor, só com prova on-chain (decisão do Atlas):
 *   - tx on-chain com SUCESSO → escritura;
 *   - tx on-chain com FALHA → libera a reserva (a sequence foi consumida, nada emitido);
 *   - tx fora da chain → NUNCA libera por "não achei" (um Horizon atrasado pode não mostrar uma tx que
 *     entrou: liberar seria mint sem escrituração e o NAV cairia). Dentro do prazo = aguardando; vencida =
 *     sem prova, fica órfã (gate do NAV fechado) para o operador decidir pelo runbook.
 *     Follow-up N1-orfa-prova: provar a não-entrada pela sequence do investidor consumida por OUTRA tx.
 * Reserva sem `submitTxHash` (anterior à migration) não é tocada: fica para o operador.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { incrementarHolding } from './holdings';
import { registrarMovimentoFundo } from './razao-fundo';
import { valorLiquidoDaCotacao } from './regras-swap';
import { assetCodeForClasse, classeOrDefault } from '../stellar/classes';
import { fetchTransactionByHash } from '../stellar/transactions';

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

/** Libera a reserva (só desta XDR e só enquanto não consumida). */
export function liberarReservaDoSwap(quoteId: string, xdrHash: string) {
  return db.quote.updateMany({
    where: { id: quoteId, submitXdrHash: xdrHash, consumedAt: null },
    data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null },
  });
}

export interface ResultadoReconciliacao {
  escriturados: number;
  liberados: number;
  /** Fora da chain e ainda dentro do prazo do envelope. */
  aguardando: number;
  /** Fora da chain e vencida: sem prova de não-entrada; fica órfã até decisão do operador. */
  vencidasSemProva: number;
  /** Reservas sem submitTxHash (anteriores à migration): precisam do operador. */
  semHash: number;
  erros: number;
}

export async function reconciliarSwapsOrfaos(
  opts: { agora?: number } = {},
): Promise<ResultadoReconciliacao> {
  const agoraSec = Math.floor((opts.agora ?? Date.now()) / 1000);
  const r: ResultadoReconciliacao = { escriturados: 0, liberados: 0, aguardando: 0, vencidasSemProva: 0, semHash: 0, erros: 0 };

  const orfas = await db.quote.findMany({
    where: { submitXdrHash: { not: null }, consumedAt: null, plinarfAmount: { not: null } },
    select: {
      id: true,
      investidorId: true,
      fromAmount: true,
      fee: true,
      classe: true,
      plinarfAmount: true,
      submitXdrHash: true,
      submitTxHash: true,
      submitMaxTime: true,
      onRampOrder: { select: { id: true } },
    },
  });

  for (const q of orfas) {
    if (!q.submitTxHash || !q.submitXdrHash) {
      r.semHash++;
      continue;
    }
    try {
      const onchain = await fetchTransactionByHash(q.submitTxHash);
      if (onchain?.successful) {
        if (!q.plinarfAmount || !q.onRampOrder) {
          r.erros++; // sem preço ou sem ordem: dado inconsistente, não escritura às cegas
          continue;
        }
        await escriturarSwap({
          quote: { id: q.id, investidorId: q.investidorId, fromAmount: q.fromAmount, fee: q.fee, classe: q.classe },
          plinarfAmount: new Prisma.Decimal(q.plinarfAmount).toFixed(7),
          finalHash: onchain.hash,
          orderId: q.onRampOrder.id,
          operador: 'reconciliador-swap',
        });
        r.escriturados++;
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
  return r;
}
