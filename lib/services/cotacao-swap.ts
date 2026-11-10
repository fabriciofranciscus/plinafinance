/**
 * Renovação do preço de emissão no `swap/build` (recotar, L1-S2).
 *
 * O NAV congelado na cotação só vale por 1 bp. Quando o cliente recebe 409
 * `NAV_MUDOU` no submit, "Gerar nova cotação" refaz o build — e o build precisa
 * RELER o NAV e atualizar `navPorTokenNaCotacao` e `plinarfAmount`, senão o 409
 * se repete. O BRL (`fromAmount`) e o TESOURO já pago (`toAmount`) não mudam;
 * só a quantidade de PLINARF.
 *
 * - cotação vigente: atualiza o preço no próprio quote;
 * - cotação expirada (mesmo com o onramp `completed`): cria um quote NOVO com o
 *   mesmo BRL/TESOURO, preço e validade novos, e religa a ordem de onramp a ele;
 * - já em submissão (`submitXdrHash`) ou consumida: não mexe (a XDR em curso
 *   tem de ser reenviada ao submit; o preço dela não pode mudar por baixo).
 *
 * Sem NAV (ledger fora, PLINARFB circulando) lança `NavIndisponivelError`.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { ApiError } from '../api/errors';
import { calcularPrecoDeEmissao } from './emissao';

/** Validade de um quote renovado: cobre build → assinatura → submit. O NAV é revalidado no submit. */
export const COTACAO_RENOVADA_TTL_MS = 5 * 60_000;

export interface CotacaoParaSwap {
  id: string;
  fromAmount: Prisma.Decimal;
  toAmount: Prisma.Decimal;
  expiresAt: Date;
  consumedAt: Date | null;
  submitXdrHash: string | null;
  investidorId: string;
  fromCurrency: string;
  toCurrency: string;
  exchangeRate: string;
  fee: string;
  classe: 'SENIOR' | 'SUBORDINADA' | null;
}

export interface CotacaoRenovada {
  id: string;
  navPorTokenNaCotacao: Prisma.Decimal;
  plinarfAmount: Prisma.Decimal;
  /** `true` quando o quote expirado foi substituído por um novo (o cliente deve usar `id`). */
  renovada: boolean;
}

export async function renovarCotacaoParaSwap(
  quote: CotacaoParaSwap,
  agora: number = Date.now(),
): Promise<CotacaoRenovada> {
  if (quote.consumedAt) throw new ApiError('CONFLICT', 409, 'quote já consumido');
  if (quote.submitXdrHash) {
    throw new ApiError(
      'CONFLICT',
      409,
      'swap já em submissão para esta cotação — reenvie o mesmo XDR ao submit',
    );
  }

  const preco = await calcularPrecoDeEmissao({ valorBrl: quote.fromAmount });
  const dados = {
    navPorTokenNaCotacao: preco.navPorTokenNaCotacao,
    plinarfAmount: preco.plinarfAmount,
  };

  if (quote.expiresAt.getTime() <= agora) {
    const id = crypto.randomUUID();
    await db.$transaction(async (tx) => {
      await tx.quote.create({
        data: {
          id,
          investidorId: quote.investidorId,
          fromCurrency: quote.fromCurrency,
          fromAmount: quote.fromAmount,
          toCurrency: quote.toCurrency,
          toAmount: quote.toAmount,
          exchangeRate: quote.exchangeRate,
          fee: quote.fee,
          classe: quote.classe,
          expiresAt: new Date(agora + COTACAO_RENOVADA_TTL_MS),
          ...dados,
        },
      });
      // A ordem de onramp (já liquidada) passa a apontar para a cotação nova.
      const ordem = await tx.onRampOrder.updateMany({
        where: { quoteId: quote.id },
        data: { quoteId: id },
      });
      if (ordem.count !== 1) throw new ApiError('CONFLICT', 409, 'ordem de onramp não encontrada para o quote');
    });
    return { id, ...dados, renovada: true };
  }

  const r = await db.quote.updateMany({
    where: { id: quote.id, consumedAt: null, submitXdrHash: null },
    data: dados,
  });
  if (r.count !== 1) throw new ApiError('CONFLICT', 409, 'quote em uso — tente de novo');
  return { id: quote.id, ...dados, renovada: false };
}
