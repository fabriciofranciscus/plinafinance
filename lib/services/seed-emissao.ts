/**
 * Emissão idempotente do seed contra o ledger (`prisma/seed.ts`).
 *
 * O issuer da testnet é compartilhado por todo banco que roda o seed (local,
 * Neon, preview). Pular a cota que já está no banco não basta: um banco vazio
 * não vê o que outro banco já emitiu, e o seed reemite. Foi o que aconteceu em
 * 16/11/2026: as mesmas 3 cotas emitidas duas vezes no mesmo ledger, e /pool
 * publicou NAV/token de -R$ 19.409.
 *
 * Cada emissão do seed leva um `Memo.hash` determinístico por cota. Antes de
 * emitir, o seed procura esse memo (`buscarEmissaoPorMemo`) e decide aqui.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { supplySemLastro } from './pool';

/** `Memo.hash` (32 bytes) que identifica a emissão de uma cota do seed. */
export function memoHashDoSeed(slug: string, code: string): Buffer {
  return createHash('sha256').update(`plina-seed:${code}:${slug}`).digest();
}

export type DecisaoDoSeed =
  | { acao: 'adotar'; txHash: string }
  | { acao: 'emitir' }
  | { acao: 'recusar'; motivo: string };

type Numericable = Prisma.Decimal | string | number;

/**
 * O que o seed faz com uma cota que ainda não está no banco:
 *
 *   - o ledger já tem a emissão do seed para a cota (memo): adota, se a
 *     quantidade bater;
 *   - o ledger tem PLINARF que o razão deste banco não registra: recusa, porque
 *     emitir de novo duplicaria (o incidente de 16/11). Mesma regra do gate do
 *     NAV (`supplySemLastro`);
 *   - senão: emite.
 */
export function decidirEmissaoDoSeed(input: {
  slug: string;
  code: string;
  /** Quantidade que o seed emitiria, com 7 casas. */
  quantidade: string;
  /** Emissão com o memo da cota já no ledger, ou `null`. */
  existente: { txHash: string; amount: string } | null;
  /** `circulante + tesouraria` da Sênior no ledger. */
  emitidoNoLedger: Numericable;
  /** Σ `MovimentoFundo.deltaTokens` deste banco. */
  noRazao: Numericable;
}): DecisaoDoSeed {
  if (input.existente) {
    if (input.existente.amount !== input.quantidade) {
      return {
        acao: 'recusar',
        motivo:
          `${input.slug}: o ledger tem a emissão ${input.existente.txHash} com ` +
          `${input.existente.amount}, mas o seed calcula ${input.quantidade}. Investigar antes de adotar.`,
      };
    }
    return { acao: 'adotar', txHash: input.existente.txHash };
  }

  const { excedente, semLastro } = supplySemLastro(input.emitidoNoLedger, input.noRazao);
  if (semLastro) {
    const D = (v: Numericable) => new Prisma.Decimal(v).toFixed(7);
    return {
      acao: 'recusar',
      motivo:
        `o ledger tem ${D(input.emitidoNoLedger)} ${input.code} emitidos e o razão deste banco ` +
        `registra ${D(input.noRazao)}. ${excedente.toFixed(7)} tokens no ledger não têm lastro neste ` +
        'banco, então emitir de novo duplicaria a emissão. Rode o seed contra o banco que emitiu ' +
        'esses tokens.',
    };
  }
  return { acao: 'emitir' };
}
