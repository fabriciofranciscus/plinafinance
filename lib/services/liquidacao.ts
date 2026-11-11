/**
 * Liquidação service — preço do resgate ao NAV do ledger.
 *
 * O resgate com QUEIMA (E2-6) vive em `./resgate.ts` (build/submit atômicos de 2 pernas: o investidor devolve o
 * PLINARF ao issuer, que o destrói, e o distributor paga o ativo-ponte). Este módulo só calcula o preço
 * (`calcularPrecoDeResgate` / `calcularValorLiquidacao`). O fluxo antigo (PLINARF de volta ao distributor, sem
 * queima, que derrubava o NAV a cada resgate) foi removido.
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { Transaction } from '@stellar/stellar-sdk';
import { networkPassphrase } from '../stellar/config';
import { distributorSigner } from '../stellar/signer';
import { caixaParaNav } from './razao-fundo';
import { NavIndisponivelError, lerSupplyDoNav } from './nav-supply';
import {
  navPorToken,
  navPorTokenAsDecimal,
  navTotalDoPool,
  tokensEmitidosVivos,
} from './pool';

export interface CalcularLiquidacaoInput {
  amountPlinarf: string;
}

export interface CalcularLiquidacaoResult {
  amountPlinarf: number;
  navPorTokenAtual: number;
  brlEquivalente: number;
  navTotalPool: number;
  tokensVivosPool: number;
}

export interface PrecoDeResgate {
  /** NAV/token, 8 casas. */
  navPorToken: Prisma.Decimal;
  /** BRL equivalente à quantidade, 2 casas. */
  brlEquivalente: Prisma.Decimal;
  navTotal: number;
  tokensVivos: number;
}

/** Preço do resgate em `Decimal` (E2-6): mesma conta e mesmas travas do `calcularValorLiquidacao`. */
export async function calcularPrecoDeResgate(input: CalcularLiquidacaoInput): Promise<PrecoDeResgate> {
  const amount = Number(input.amountPlinarf);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error('amountPlinarf inválido');
  }
  // Trava D3 + fonte única de asset code: o denominador vem de `lerSupplyDoNav`
  // (mesma leitura da tela). `fresh`: cotação de resgate move dinheiro, não usa TTL.
  const [cotas, realizacoes, { senior: supply }] = await Promise.all([
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      select: {
        valorCarta: true,
        desagioAquisicao: true,
        tokensEmitidos: true,
        status: true,
      },
    }),
    caixaParaNav(), // E2-5: caixa do NAV vem do razão
    lerSupplyDoNav({ fresh: true }),
  ]);
  const navTotal = navTotalDoPool(cotas, realizacoes);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const unitDec = navPorTokenAsDecimal(cotas, realizacoes, supply);
  // Fail-closed: NAV <= 0 significa que o ativo atribuível não cobre a
  // tesouraria, ou que nada foi emitido a investidor. Nos dois casos não
  // existe cotação honesta — e um BRL negativo chegaria na tela.
  if (unitDec.lte(0)) {
    // Mensagem pública constante (a rota devolve 503 fixo); o motivo vai ao log.
    throw new NavIndisponivelError('NAV_NAO_POSITIVO');
  }
  const brlEquivalenteDec = unitDec
    .mul(new Prisma.Decimal(input.amountPlinarf))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
  return { navPorToken: unitDec, brlEquivalente: brlEquivalenteDec, navTotal, tokensVivos };
}


/**
 * Calcula BRL simulado equivalente a uma quantidade de PLINA-RF a NAV atual.
 *
 * NAV/token = ativo atribuível / supply circulante **lido do ledger**. A
 * leitura do Horizon falha fechada de propósito: precificar um resgate com o
 * denominador antigo (estado da aplicação) era a dupla contagem que este
 * cálculo passou a evitar, e recusar a cotação é melhor que entregar um
 * número errado.
 */
export async function calcularValorLiquidacao(
  input: CalcularLiquidacaoInput,
): Promise<CalcularLiquidacaoResult> {
  const amount = Number(input.amountPlinarf);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error('amountPlinarf inválido');
  }
  const p = await calcularPrecoDeResgate(input);
  return {
    amountPlinarf: amount,
    navPorTokenAtual: p.navPorToken.toNumber(),
    brlEquivalente: p.brlEquivalente.toNumber(),
    navTotalPool: p.navTotal,
    tokensVivosPool: p.tokensVivos,
  };
}

/**
 * Pre-sign de uma tx com a chave do distributor (não usado no flow atual,
 * mas pode ser útil pra fluxos futuros que exijam co-assinatura).
 */
export function preSignDistributor(xdr: string): {
  pubkey: string;
  sigBase64: string;
} {
  const signer = distributorSigner();
  const tx = new Transaction(xdr, networkPassphrase);
  return { pubkey: signer.publicKey(), sigBase64: signer.signatureBase64(tx) };
}
