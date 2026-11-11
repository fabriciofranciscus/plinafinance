/**
 * Regras puras do resgate com queima (E2-6; contrato 2026-11-11-e2-4-resgate-api). Sem banco nem rede.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Keypair, type Transaction } from '@stellar/stellar-sdk';
import { STELLAR_TX_TIMEOUT_SEC } from '../stellar/config';

/** Folgas da janela de validade (as mesmas do validador do swap, N1-S1). */
export const FOLGA_RELOGIO_MAX_SEC = 60;
export const FOLGA_RELOGIO_MIN_SEC = 5;
export const FOLGA_COTACAO_SEC = 120;
/** Validade da cotação do resgate. */
export const COTACAO_RESGATE_TTL_MS = 5 * 60_000;

const AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;

/** Quantidade de PLINARF a queimar: decimal > 0, até 7 casas (formato Stellar). */
export function amountPlinarfValido(v: unknown): Prisma.Decimal | null {
  if (typeof v !== 'string' || !AMOUNT.test(v)) return null;
  const d = new Prisma.Decimal(v);
  return d.gt(0) ? d : null;
}

/** TESOURO a pagar = BRL × taxa BRL→TESOURO, 7 casas, para BAIXO (favorece o fundo). Taxa inválida → null. */
export function bridgeAmountDoResgate(brl: Prisma.Decimal, taxa: string): Prisma.Decimal | null {
  let t: Prisma.Decimal;
  try {
    t = new Prisma.Decimal(taxa);
  } catch {
    return null;
  }
  if (!t.isFinite() || !t.gt(0)) return null;
  const v = brl.mul(t).toDecimalPlaces(7, Prisma.Decimal.ROUND_DOWN);
  return v.gt(0) ? v : null;
}

/** Memo.hash do envelope do resgate. NÃO usa o prefixo `plina:incorporacao:` (exclusivo da emissão). */
export function memoHashDoResgate(quoteId: string): Buffer {
  return createHash('sha256').update(`plina:resgate:${quoteId}`).digest();
}

/**
 * Janela de validade do envelope (N1-S1 estendido ao resgate: quem assina é o distributor, que paga TESOURO):
 * timeBounds obrigatório, 0 < maxTime ≤ agora + 180 s e ≤ expiresAt + 120 s, minTime ≤ agora + 5 s.
 */
export function assertJanelaDoResgate(tx: Transaction, expiresAt: Date, agoraSec: number): void {
  const tb = tx.timeBounds;
  if (!tb) throw new Error('xdr sem timeBounds: a janela de validade é obrigatória');
  const maxTime = Number(tb.maxTime);
  const minTime = Number(tb.minTime);
  if (!Number.isFinite(maxTime) || maxTime <= 0) throw new Error('xdr maxTime ausente (0): a tx valeria para sempre');
  const limite = agoraSec + STELLAR_TX_TIMEOUT_SEC + FOLGA_RELOGIO_MAX_SEC;
  if (maxTime > limite) throw new Error(`xdr maxTime=${maxTime} além do limite ${limite}`);
  const limiteCotacao = Math.floor(expiresAt.getTime() / 1000) + FOLGA_COTACAO_SEC;
  if (maxTime > limiteCotacao) throw new Error(`xdr maxTime=${maxTime} além do prazo da cotação + ${FOLGA_COTACAO_SEC} s`);
  if (!Number.isFinite(minTime) || minTime > agoraSec + FOLGA_RELOGIO_MIN_SEC) {
    throw new Error(`xdr minTime=${minTime} no futuro`);
  }
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
