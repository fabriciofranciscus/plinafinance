/**
 * Preço de REFERÊNCIA do TESOURO, independente da cotação do resgate (Argus R2, decisão do Atlas): o preço líquido
 * ((fromAmount − fee) ÷ toAmount) do ÚLTIMO swap de subscrição escriturado. `RESGATE_PRECO_TESOURO_REF` (decimal > 0,
 * mantido pela operação) tem prioridade quando configurado. Sem nenhum dos dois → `null` (o resgate recusa, fail-closed).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { precoLiquidoDoTesouro } from './regras-resgate';

export async function obterPrecoReferenciaTesouro(): Promise<Prisma.Decimal | null> {
  const cfg = (process.env.RESGATE_PRECO_TESOURO_REF ?? '').trim();
  if (cfg) {
    try {
      const d = new Prisma.Decimal(cfg);
      if (d.isFinite() && d.gt(0)) return d;
    } catch {
      /* config inválida: ignora e tenta o último swap */
    }
  }
  const q = await db.quote.findFirst({
    where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
    orderBy: { consumedAt: 'desc' },
    select: { fromAmount: true, fee: true, toAmount: true },
  });
  if (!q) return null;
  return precoLiquidoDoTesouro({ fromAmount: q.fromAmount.toString(), fee: q.fee, toAmount: q.toAmount.toString() });
}
