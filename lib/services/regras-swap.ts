/**
 * Regras puras da subscrição por swap (N1, decisões do Atlas sobre o parecer da Consuelo).
 * Sem banco nem rede: pode ser importada por rotas e serviços sem puxar o ledger.
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../api/errors';

/**
 * N1 (Atlas/Consuelo): a classe Subordinada não tem NAV próprio — emitiria PLINARFB ao NAV da
 * Sênior e a trava D3 desligaria o NAV de toda a plataforma. Recusada até existir NAV por subclasse.
 */
export function assertClasseDisponivel(classe: string | null | undefined): void {
  if (classe === 'SUBORDINADA') {
    throw new ApiError(
      'CLASSE_INDISPONIVEL',
      422,
      'A classe Subordinada ainda não está disponível. Escolha a classe Sênior.',
    );
  }
}

/**
 * N1 (Consuelo, MÉDIO): V = valor LÍQUIDO que chega ao fundo = BRL pago (`fromAmount`) menos o fee da
 * Etherfuse (`fee`, em BRL). O fundo recebe o TESOURO líquido do fee, então `q` e o caixa usam V; o fee
 * fica com o investidor. Fee ausente/vazio = 0; fee inválido, negativo ou que zera o valor → cotação recusada.
 */
export function valorLiquidoDaCotacao(quote: {
  fromAmount: Prisma.Decimal | string | number;
  fee?: string | null;
}): Prisma.Decimal {
  const invalida = () =>
    new ApiError('CONFLICT', 409, 'cotação com fee inválido — refaça a cotação');
  let fee: Prisma.Decimal;
  try {
    const bruto = (quote.fee ?? '').toString().trim();
    fee = bruto === '' ? new Prisma.Decimal(0) : new Prisma.Decimal(bruto);
  } catch {
    throw invalida();
  }
  const liquido = new Prisma.Decimal(quote.fromAmount)
    .minus(fee)
    .toDecimalPlaces(7, Prisma.Decimal.ROUND_HALF_EVEN);
  if (!fee.isFinite() || fee.isNegative() || !liquido.gt(0)) throw invalida();
  return liquido;
}
