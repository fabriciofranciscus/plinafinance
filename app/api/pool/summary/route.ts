/**
 * GET /api/pool/summary
 *
 * Agregados públicos do pool: parametros + cotas ativas + NAV total +
 * tokens vivos. Usado por surfaces que precisam de visão executiva
 * (/minha-posicao, futuramente widgets em /).
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  navDaCota,
  navTotalDoPool,
  tokensEmitidosVivos,
} from '@/lib/services/pool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [parametros, cotas] = await Promise.all([
    db.parametrosPool.findUnique({ where: { id: 'singleton' } }),
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      orderBy: { criadaEm: 'asc' },
      select: {
        tipoBem: true,
        valorCarta: true,
        desagioAquisicao: true,
        tokensEmitidos: true,
        statusEstoque: true,
        status: true,
        prazoRestanteMeses: true,
      },
    }),
  ]);

  const navTotal = navTotalDoPool(cotas);
  const tokensVivos = tokensEmitidosVivos(cotas);

  const tipoBemCount: Record<string, number> = {};
  for (const c of cotas) {
    tipoBemCount[c.tipoBem] = (tipoBemCount[c.tipoBem] ?? 0) + 1;
  }
  const navPorTipo: Record<string, number> = {};
  for (const c of cotas) {
    const nav = navDaCota({
      valorCarta: c.valorCarta,
      desagioAquisicao: c.desagioAquisicao,
    });
    navPorTipo[c.tipoBem] = (navPorTipo[c.tipoBem] ?? 0) + nav;
  }

  return NextResponse.json({
    assetCode: parametros?.assetCode ?? 'PLINARF',
    network: parametros?.network ?? 'TESTNET',
    issuerPubkey: parametros?.issuerPubkey ?? '',
    distributorPubkey: parametros?.distributorPubkey ?? '',
    navTotal,
    tokensVivos,
    cotasCount: cotas.length,
    tipoBemCount,
    navPorTipo,
  });
}
