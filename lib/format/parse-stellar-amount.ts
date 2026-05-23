/**
 * Normaliza um valor monetário pra precisão Stellar (7 casas decimais =
 * stroops). Aceita `string` ou `Prisma.Decimal`; rejeita scientific notation,
 * vírgula como separador, negativos, NaN e qualquer coisa com >7 casas.
 *
 * Por que não `Number(x).toFixed(7)`: IEEE-754 perde stroops em valores
 * grandes (R$10M+). Decimal end-to-end garante que DB, audit e Stellar
 * concordam até o último stroop.
 *
 * Retorna `Prisma.Decimal` com no máximo 7 casas. Não trunca silencioso:
 * "1.12345678" (8 casas) é erro, não "1.1234567".
 */
import { Prisma } from '@prisma/client';

const STELLAR_AMOUNT_RE = /^\d{1,12}(\.\d{1,7})?$/;

export function parseStellarAmount(input: unknown): Prisma.Decimal {
  let str: string;
  if (input instanceof Prisma.Decimal) {
    str = input.toFixed();
  } else if (typeof input === 'string') {
    str = input.trim();
  } else {
    throw new Error('amount inválido: esperado string ou Decimal');
  }

  if (!STELLAR_AMOUNT_RE.test(str)) {
    throw new Error(
      `amount inválido: "${str}" — esperado N[.D] com até 12 dígitos inteiros e 7 decimais`,
    );
  }

  const dec = new Prisma.Decimal(str);
  if (dec.isZero() || dec.isNegative()) {
    throw new Error('amount inválido: deve ser positivo');
  }
  return dec;
}

/**
 * Conveniência: retorna a string formatada em 7 casas (sem perda),
 * pronta pra Stellar SDK (`Operation.payment({ amount })`).
 */
export function toStellarAmountString(input: unknown): string {
  return parseStellarAmount(input).toFixed(7);
}
