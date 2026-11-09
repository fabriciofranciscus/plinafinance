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
  navAtribuivel,
  navDaCota,
  navPorToken,
  navTotalDoPool,
  spreadRealizadoAcumulado,
  tokensEmitidosVivos,
} from '@/lib/services/pool';
import { fetchSupplyOnChainFromEnv } from '@/lib/stellar/supply';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { isSorobanWaterfallEnabled } from '@/lib/env/feature-gates';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (_req, { requestId }) => {
  // F-M0-6 / M7: fonte do denominador do NAV. O supply vem do ledger
  // (`lib/stellar/supply.ts`); quando SOROBAN_WATERFALL estiver on, o M7
  // passa a ler o NAV do nav_oracle on-chain em vez de calcular aqui.
  const sorobanWaterfall = await isSorobanWaterfallEnabled();
  const navSource = sorobanWaterfall ? 'soroban' : 'ledger';
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

  // Separado do Promise.all acima: se o ledger não responde, o NAV não
  // existe, e devolver 503 com código próprio é melhor que publicar um
  // número derivado do estado da aplicação.
  let supply;
  try {
    supply = await fetchSupplyOnChainFromEnv(parametros?.assetCode);
  } catch (err) {
    throw new ApiError(
      'LEDGER_UNAVAILABLE',
      503,
      `supply on-chain indisponível: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
    );
  }

  const navTotal = navTotalDoPool(cotas, realizacoes);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const navUnit = navPorToken(cotas, realizacoes, supply);
  const atribuivel = navAtribuivel(cotas, realizacoes, supply);
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
      navAtribuivel: atribuivel,
      // O que um alocador confere no explorer: o denominador do NAV e suas
      // partes. `circulante` = totalEmitido - tesouraria.
      supply: {
        totalEmitido: supply.totalEmitido.toString(),
        circulante: supply.circulante.toString(),
        tesouraria: supply.tesouraria.toString(),
        autorizado: supply.autorizado.toString(),
        naoAutorizado: supply.naoAutorizado.toString(),
        emTransito: supply.emTransito.toString(),
        contas: supply.contas,
        temSaldoCongelado: supply.temSaldoCongelado,
        lidoEm: supply.lidoEm.toISOString(),
      },
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
