/**
 * Escrituração do resgate com queima (E2-6) — módulo leve (só banco, holdings e razão), importável pelo
 * `resgate.ts` (submit) e pelo reconciliador de órfãs sem puxar o Stellar.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { decrementarHolding } from './holdings';
import { registrarMovimentoFundo } from './razao-fundo';

type CotacaoRow = NonNullable<Awaited<ReturnType<typeof db.resgateCotacao.findFirst>>>;

/** Commit de domínio DEPOIS da chain (usado pelo submit e, depois, pelo reconciliador de órfãs). */
export async function escriturarResgate(input: {
  cotacao: Pick<CotacaoRow, 'id' | 'investidorId' | 'classe' | 'plinarfAmount' | 'brlEquivalente' | 'bridgeAmount' | 'navPorTokenNaCotacao'>;
  finalHash: string;
  privyId?: string | null;
  operador?: string;
}): Promise<void> {
  const { cotacao: c, finalHash } = input;
  const tokens = new Prisma.Decimal(c.plinarfAmount).toFixed(7);
  await db.$transaction(async (tx) => {
    const consumed = await tx.resgateCotacao.updateMany({
      where: { id: c.id, consumedAt: null },
      data: { consumedAt: new Date(), consumedTxHash: finalHash },
    });
    if (consumed.count !== 1) throw new Error('cotação de resgate consumida concorrentemente — abortando');
    // Caixa −V e tokens −q (RESGATE_PAGO): o supply já caiu na chain (queima) e o caixa sai aqui, juntos.
    await registrarMovimentoFundo(tx, {
      tipo: 'RESGATE_PAGO',
      valorBrl: c.brlEquivalente,
      tokens,
      chave: `resgate:${c.id}`,
      refHash: finalHash,
      txHash: finalHash,
      navPorToken: c.navPorTokenNaCotacao,
    });
    await decrementarHolding(tx, {
      investidorId: c.investidorId,
      classe: c.classe,
      amount: tokens,
      txHash: finalHash,
    });
    await tx.investidor.update({
      where: { id: c.investidorId },
      data: { saldoEsperado: { decrement: new Prisma.Decimal(tokens) } },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'PLINARF_LIQUIDADO',
        operador: input.operador ?? 'investidor-self-service',
        investidorId: c.investidorId,
        privyId: input.privyId ?? null,
        stellarTxHash: finalHash,
        payloadJson: {
          quoteId: c.id,
          amountPlinarf: tokens,
          brlEquivalente: new Prisma.Decimal(c.brlEquivalente).toFixed(2),
          bridgeAmount: new Prisma.Decimal(c.bridgeAmount).toFixed(7),
          navPorToken: new Prisma.Decimal(c.navPorTokenNaCotacao).toFixed(8),
          queima: true,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Libera a reserva (só desta XDR e só enquanto não consumida). `porTempo` guarda o hash liberado na vigia de 24 h
 * (mesma regra do swap, N1): a liberação por tempo não prova que a tx não entrou, só que a rede passou do prazo dela.
 */
export function liberarReservaDoResgate(
  quoteId: string,
  xdrHash: string,
  opts: { porTempo?: { txHash: string } } = {},
) {
  return db.resgateCotacao.updateMany({
    where: { id: quoteId, submitXdrHash: xdrHash, consumedAt: null },
    data: {
      submitXdrHash: null,
      submitTxHash: null,
      submitMaxTime: null,
      submitXdr: null,
      livreExpiradaVistaEm: null,
      ...(opts.porTempo ? { liberadaTxHash: opts.porTempo.txHash, liberadaPorTempoEm: new Date() } : {}),
    },
  });
}
