/**
 * Regras puras do resgate com queima (E2-6; contrato 2026-11-11-e2-4-resgate-api). Sem banco nem rede.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Keypair, type Transaction } from '@stellar/stellar-sdk';

/** Validade da cotação do resgate. */
export const COTACAO_RESGATE_TTL_MS = 5 * 60_000;

const AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;

/** Quantidade de PLINARF a queimar: decimal > 0, até 7 casas (formato Stellar). */
export function amountPlinarfValido(v: unknown): Prisma.Decimal | null {
  if (typeof v !== 'string' || !AMOUNT.test(v)) return null;
  const d = new Prisma.Decimal(v);
  return d.gt(0) ? d : null;
}

/**
 * Preço LÍQUIDO do TESOURO em BRL (mesma base da subscrição, Consuelo/Atlas): (fromAmount − fee) ÷ toAmount da
 * cotação Etherfuse BRL→TESOURO feita na hora. Qualquer dado inválido, fee negativo ou resultado ≤ 0 → null.
 */
export function precoLiquidoDoTesouro(q: { fromAmount: string; fee?: string | null; toAmount: string }): Prisma.Decimal | null {
  try {
    const de = new Prisma.Decimal(q.fromAmount);
    const fee = new Prisma.Decimal((q.fee ?? '').toString().trim() === '' ? '0' : String(q.fee));
    const para = new Prisma.Decimal(q.toAmount);
    if (!de.isFinite() || !fee.isFinite() || !para.isFinite() || fee.isNegative() || !para.gt(0)) return null;
    const preco = de.minus(fee).div(para);
    return preco.isFinite() && preco.gt(0) ? preco : null;
  } catch {
    return null;
  }
}

/** TESOURO a pagar = BRL ÷ preço líquido, 7 casas, para BAIXO (favorece o fundo). Preço inválido → null. */
export function bridgeAmountDoResgate(brl: Prisma.Decimal, precoTesouroBrl: string | Prisma.Decimal): Prisma.Decimal | null {
  let p: Prisma.Decimal;
  try {
    p = new Prisma.Decimal(precoTesouroBrl);
  } catch {
    return null;
  }
  if (!p.isFinite() || !p.gt(0)) return null;
  const v = brl.div(p).toDecimalPlaces(7, Prisma.Decimal.ROUND_DOWN);
  return v.gt(0) ? v : null;
}

/** Memo.hash do envelope do resgate. NÃO usa o prefixo `plina:incorporacao:` (exclusivo da emissão). */
export function memoHashDoResgate(quoteId: string): Buffer {
  return createHash('sha256').update(`plina:resgate:${quoteId}`).digest();
}

/**
 * Assinatura do investidor no envelope: exatamente UMA, com o hint da chave dele e válida sobre o hash da tx.
 * Devolve os 64 bytes ou `null` (verificada ANTES de a Plina assinar).
 */
export function assinaturaUnicaDoInvestidor(tx: Transaction, investorPubkey: string): Buffer | null {
  if (tx.signatures.length !== 1) return null;
  const sig = tx.signatures[0];
  try {
    const kp = Keypair.fromPublicKey(investorPubkey);
    if (!sig.hint().equals(kp.signatureHint())) return null;
    const raw = sig.signature();
    return kp.verify(tx.hash(), raw) ? Buffer.from(raw) : null;
  } catch {
    return null;
  }
}
