/**
 * Preço de REFERÊNCIA do TESOURO, independente da cotação do resgate (Argus R2 + F7; regra da Consuelo, decisão do
 * Atlas). O TESOURO é pós-fixado: uma referência parada sai da faixa de ±2% em ~2 meses e bloquearia todo resgate.
 *   1. Candidatos: o preço líquido ((fromAmount − fee) ÷ toAmount) do ÚLTIMO swap escriturado (data = consumedAt) e a
 *      config `PRECO_TESOURO_REF_BRL` (data = `PRECO_TESOURO_REF_DATA`, ISO-8601). Vale o de data MAIS RECENTE.
 *   2. Corrigido até agora por (1 + TESOURO_TAXA_ANUAL)^(dias/365); a faixa de ±2% (quem usa) é sobre o valor corrigido.
 *      `TESOURO_TAXA_ANUAL` ausente/inválida = 0 (sem correção; com o teto de 30 dias o erro fica < 2%).
 *   3. Referência com mais de 30 dias → `VENCIDA` (o resgate recusa, fail-closed, e a operação é alertada).
 * Sem nenhum candidato válido → `AUSENTE` (recusa).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { precoLiquidoDoTesouro } from './regras-resgate';

/** Idade máxima (dias) de qualquer referência. */
export const REFERENCIA_MAX_IDADE_DIAS = 30;
const DIA_MS = 24 * 3600_000;

export type ReferenciaPreco =
  | { status: 'OK'; preco: Prisma.Decimal; base: Prisma.Decimal; idadeDias: number; origem: 'SWAP' | 'CONFIG' }
  | { status: 'VENCIDA'; idadeDias: number; origem: 'SWAP' | 'CONFIG' }
  | { status: 'AUSENTE' };

function decimalPositivo(v: string | undefined): Prisma.Decimal | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  try {
    const d = new Prisma.Decimal(t);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/** Taxa anual ≥ 0 (ex.: 0.14); ausente/inválida/negativa → 0. */
function taxaAnual(v: string | undefined): Prisma.Decimal {
  const t = (v ?? '').trim();
  if (!t) return new Prisma.Decimal(0);
  try {
    const d = new Prisma.Decimal(t);
    return d.isFinite() && !d.isNegative() ? d : new Prisma.Decimal(0);
  } catch {
    return new Prisma.Decimal(0);
  }
}

/** Corrige `base` do instante `desde` até `agora` por (1 + taxa)^(dias/365). Data no futuro conta como 0 dia. */
export function corrigirReferencia(base: Prisma.Decimal, desde: number, agora: number, taxa: Prisma.Decimal): Prisma.Decimal {
  const dias = Math.max(0, agora - desde) / DIA_MS;
  if (taxa.isZero() || dias === 0) return base;
  return base.mul(new Prisma.Decimal(1).plus(taxa).pow(new Prisma.Decimal(dias).div(365)));
}

export async function obterPrecoReferenciaTesouro(agora: number = Date.now()): Promise<ReferenciaPreco> {
  const candidatos: Array<{ preco: Prisma.Decimal; em: number; origem: 'SWAP' | 'CONFIG' }> = [];

  const q = await db.quote.findFirst({
    where: { consumedAt: { not: null }, toCurrency: 'TESOURO' },
    orderBy: { consumedAt: 'desc' },
    select: { fromAmount: true, fee: true, toAmount: true, consumedAt: true },
  });
  if (q?.consumedAt) {
    const p = precoLiquidoDoTesouro({ fromAmount: q.fromAmount.toString(), fee: q.fee, toAmount: q.toAmount.toString() });
    if (p) candidatos.push({ preco: p, em: q.consumedAt.getTime(), origem: 'SWAP' });
  }

  const cfgPreco = decimalPositivo(process.env.PRECO_TESOURO_REF_BRL);
  const cfgEm = Date.parse((process.env.PRECO_TESOURO_REF_DATA ?? '').trim());
  if (cfgPreco && Number.isFinite(cfgEm)) candidatos.push({ preco: cfgPreco, em: cfgEm, origem: 'CONFIG' });

  if (candidatos.length === 0) return { status: 'AUSENTE' };
  const ref = candidatos.reduce((a, b) => (b.em > a.em ? b : a)); // o MAIS RECENTE (empate: o swap, que vem primeiro)
  const idadeDias = Math.max(0, agora - ref.em) / DIA_MS;
  if (idadeDias > REFERENCIA_MAX_IDADE_DIAS) return { status: 'VENCIDA', idadeDias, origem: ref.origem };
  const taxa = taxaAnual(process.env.TESOURO_TAXA_ANUAL);
  return { status: 'OK', preco: corrigirReferencia(ref.preco, ref.em, agora, taxa), base: ref.preco, idadeDias, origem: ref.origem };
}
