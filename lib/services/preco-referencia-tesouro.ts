/**
 * Preço de REFERÊNCIA do TESOURO, independente da cotação do resgate (Argus R2, decisão do Atlas): o preço líquido
 * ((fromAmount − fee) ÷ toAmount) do ÚLTIMO swap de subscrição escriturado. Sem swap escriturado, vale a config
 * `PRECO_TESOURO_REF_BRL` (decimal > 0, do Farol). Sem nenhum dos dois → `null` (o resgate recusa, fail-closed).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { precoLiquidoDoTesouro } from './regras-resgate';

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

export async function obterPrecoReferenciaTesouro(): Promise<Prisma.Decimal | null> {
  const q = await db.quote.findFirst({
    where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
    orderBy: { consumedAt: 'desc' },
    select: { fromAmount: true, fee: true, toAmount: true },
  });
  if (q) {
    const p = precoLiquidoDoTesouro({ fromAmount: q.fromAmount.toString(), fee: q.fee, toAmount: q.toAmount.toString() });
    if (p) return p;
  }
  return precoDaConfig();
}
