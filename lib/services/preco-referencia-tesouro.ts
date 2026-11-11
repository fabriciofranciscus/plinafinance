/**
 * Preço de REFERÊNCIA do TESOURO, independente da cotação do resgate (Argus R2, decisão do Atlas): o preço líquido
 * ((fromAmount − fee) ÷ toAmount) do ÚLTIMO swap de subscrição escriturado, desde que tenha no máximo 7 dias (F7: o
 * TESOURO rende, uma referência velha tiraria todo resgate da faixa). Mais velho que isso — ou sem swap — vale a config
 * `PRECO_TESOURO_REF_BRL` (decimal > 0, do Farol). Sem nenhum dos dois → `null` (o resgate recusa, fail-closed).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { precoLiquidoDoTesouro } from './regras-resgate';

/** Idade máxima do swap usado como referência. */
export const REFERENCIA_SWAP_MAX_IDADE_MS = 7 * 24 * 3600_000;

function precoDaConfig(): Prisma.Decimal | null {
  const cfg = (process.env.PRECO_TESOURO_REF_BRL ?? '').trim();
  if (!cfg) return null;
  try {
    const d = new Prisma.Decimal(cfg);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null; // config inválida: como se não existisse
  }
}

export async function obterPrecoReferenciaTesouro(agora: number = Date.now()): Promise<Prisma.Decimal | null> {
  const q = await db.quote.findFirst({
    where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
    orderBy: { consumedAt: 'desc' },
    select: { fromAmount: true, fee: true, toAmount: true, consumedAt: true },
  });
  if (q?.consumedAt && agora - q.consumedAt.getTime() <= REFERENCIA_SWAP_MAX_IDADE_MS) {
    const p = precoLiquidoDoTesouro({ fromAmount: q.fromAmount.toString(), fee: q.fee, toAmount: q.toAmount.toString() });
    if (p) return p;
  }
  return precoDaConfig();
}
