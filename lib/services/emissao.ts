/**
 * Preço de emissão ao NAV (M1-3, ADR 2026-11-09 opção B). Lê o estado do fundo
 * e o supply do ledger (trava D3 + fail-closed, via `lerSupplyDoNav`) e devolve
 * o NAV/token congelado para a cotação e a quantidade de PLINARF que o BRL
 * integralizado compra. O BRL vem de `quote.fromAmount`.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { ApiError } from '../api/errors';
import { NavIndisponivelError, lerSupplyDoNav } from './nav-supply';
import { caixaParaNav } from './razao-fundo';
import { navParaEmissao, quantidadeEmitida } from './pool';

export interface PrecoDeEmissao {
  /** NAV/token usado, 8 casas (precisão do NAV em pool.ts). */
  navPorTokenNaCotacao: Prisma.Decimal;
  /** PLINARF a emitir, truncado a 7 casas. */
  plinarfAmount: Prisma.Decimal;
}

export async function calcularPrecoDeEmissao(input: {
  valorBrl: Prisma.Decimal | string | number;
}): Promise<PrecoDeEmissao> {
  // `fresh`: emissão move dinheiro, não usa o TTL da rota pública.
  const [cotas, realizacoes, { senior }] = await Promise.all([
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      select: {
        valorCarta: true,
        desagioAquisicao: true,
        tokensEmitidos: true,
        status: true,
      },
    }),
    caixaParaNav(),
    lerSupplyDoNav({ fresh: true }),
  ]);

  let nav: Prisma.Decimal;
  try {
    nav = navParaEmissao(cotas, realizacoes, senior);
  } catch {
    throw new NavIndisponivelError('NAV_NAO_POSITIVO');
  }

  const plinarfAmount = quantidadeEmitida(input.valorBrl, nav);
  if (!plinarfAmount.gt(0)) {
    throw new ApiError('VALIDATION_FAILED', 400, 'valor abaixo do mínimo emitível ao NAV atual');
  }
  return { navPorTokenNaCotacao: nav, plinarfAmount };
}
