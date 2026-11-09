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
import { caixaParaNav } from '@/lib/services/razao-fundo';
import { assetCodeForClasse } from '@/lib/stellar/classes';
import {
  NAV_INDISPONIVEL_MENSAGEM,
  NavIndisponivelError,
  lerSupplyDoNav,
} from '@/lib/services/nav-supply';
import { clientIp, publicLimiter } from '@/lib/rate-limit/config';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { isSorobanWaterfallEnabled } from '@/lib/env/feature-gates';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req, { requestId }) => {
  // Rota pública: rate-limit antes de qualquer leitura (DB ou ledger).
  if (!(await publicLimiter.consume(clientIp(req)))) {
    throw new ApiError('RATE_LIMITED', 429, 'Too Many Requests');
  }

  // Ledger primeiro: sem supply não há NAV (fail-closed) e não vale gastar DB.
  // Leitura com TTL + single-flight e trava D3 (PLINARFB circulando → 503), em
  // `lerSupplyDoNav`. Corpo do 503 é constante; a causa vai só ao log, com o
  // requestId, e nunca `err.message` ao cliente.
  let supply;
  try {
    supply = (await lerSupplyDoNav()).senior;
  } catch (err) {
    console.error('[pool/summary] NAV indisponível', {
      requestId,
      motivo: err instanceof NavIndisponivelError ? err.motivo : 'DESCONHECIDO',
    });
    throw new ApiError('LEDGER_UNAVAILABLE', 503, NAV_INDISPONIVEL_MENSAGEM);
  }

  // F-M0-6 / M7: fonte do denominador do NAV. O supply vem do ledger
  // (`lib/stellar/supply.ts`); quando SOROBAN_WATERFALL estiver on, o M7
  // passa a ler o NAV do nav_oracle on-chain em vez de calcular aqui.
  const sorobanWaterfall = await isSorobanWaterfallEnabled();
  const navSource = sorobanWaterfall ? 'soroban' : 'ledger';
  const [parametros, cotas, realizacoes, caixaNav] = await Promise.all([
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
    // E2-5: o caixa do NAV vem do razão do fundo, não das realizações.
    caixaParaNav(),
  ]);

  const navTotal = navTotalDoPool(cotas, caixaNav);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const navUnit = navPorToken(cotas, caixaNav, supply);
  const atribuivel = navAtribuivel(cotas, caixaNav, supply);
  const caixa = caixaRealizado(caixaNav);
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
      // Fonte única do asset code (a mesma do supply e do resgate).
      assetCode: assetCodeForClasse('SENIOR'),
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
