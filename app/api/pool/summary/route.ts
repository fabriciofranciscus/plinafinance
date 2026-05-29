/**
 * GET /api/pool/summary
 *
 * Agregados públicos do pool: parametros + cotas ativas + NAV total +
 * tokens vivos. Usado por surfaces que precisam de visão executiva
 * (/minha-posicao, futuramente widgets em /).
 *
 * Migrada pro envelope `{ data, error: { code, message, requestId } }`
 * via `withApi` — primeira rota a adotar o pattern. Rotas restantes
 * continuam com `NextResponse.json` cru até serem migradas; envelope é
 * opt-in.
 */

import { db } from '@/lib/db';
import {
  caixaRealizado,
  navDaCota,
  navPorToken,
  navTotalDoPool,
  spreadRealizadoAcumulado,
  tokensEmitidosVivos,
} from '@/lib/services/pool';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { isSorobanWaterfallEnabled } from '@/lib/env/feature-gates';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (_req, { requestId }) => {
  // F-M0-6 / M7: fonte do NAV. Hoje sempre Postgres (`lib/services/pool.ts`);
  // quando SOROBAN_WATERFALL estiver on, o M7 lê do nav_oracle on-chain.
  const sorobanWaterfall = await isSorobanWaterfallEnabled();
  const navSource = sorobanWaterfall ? 'soroban' : 'postgres';
  const [parametros, cotas, realizacoes] = await Promise.all([
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
    db.realizacaoCaminho.findMany({
      select: { valorRealizado: true, spread: true },
    }),
  ]);

  const navTotal = navTotalDoPool(cotas, realizacoes);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const navUnit = navPorToken(cotas, realizacoes);
  const caixa = caixaRealizado(realizacoes);
  const spreadAcumulado = spreadRealizadoAcumulado(realizacoes);

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

  return ok(
    {
      assetCode: parametros?.assetCode ?? 'PLINARF',
      network: parametros?.network ?? 'TESTNET',
      issuerPubkey: parametros?.issuerPubkey ?? '',
      distributorPubkey: parametros?.distributorPubkey ?? '',
      navTotal,
      tokensVivos,
      navPorToken: navUnit,
      caixaRealizado: caixa,
      spreadRealizadoAcumulado: spreadAcumulado,
      realizacoesCount: realizacoes.length,
      cotasCount: cotas.length,
      tipoBemCount,
      navPorTipo,
      navSource,
    },
    { requestId },
  );
});
