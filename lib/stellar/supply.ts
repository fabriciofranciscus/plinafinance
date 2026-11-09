/**
 * Supply de PLINA-RF lido do ledger.
 *
 * Antes deste módulo o NAV derivava o denominador do estado da aplicação
 * (`tokensEmitidos` das cotas ativas no Postgres). Isso tinha dois defeitos,
 * e o número errado precificava **toda** emissão e **todo** resgate:
 *
 *   1. Cota realizada saía do denominador mas seu caixa entrava no
 *      numerador, embora os tokens continuassem on-chain nas carteiras.
 *   2. Com o pool em runoff (todas as cotas realizadas) o denominador ia a
 *      zero e o NAV/token colapsava — justamente quando os investidores
 *      precisam liquidar.
 *
 * A fonte da verdade de saldo é o Horizon ("DB depois da chain", princípio
 * invariante da ARQUITETURA-ALVO). Aqui lemos `/assets`, que agrega o asset
 * inteiro num registro, e reconciliamos contra as trustlines autorizadas do
 * issuer — a conferência que um alocador refaz no explorer.
 *
 * Nota sobre o que o Horizon devolve: `/assets` **exclui** o saldo do
 * próprio issuer, porque um asset Stellar não tem "supply" no ledger — o
 * issuer cunha ao pagar. Então a soma dos campos abaixo já é o total emitido
 * e ainda não queimado.
 */

import { Prisma } from '@prisma/client';
import { getAssetBalance, horizon } from './account';
import { STELLAR_NETWORK, assetCode } from './config';
import { withSpan } from '../observability/tracer';

const ZERO = new Prisma.Decimal(0);

function dec(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export interface SupplyOnChain {
  /** Code do asset consultado (PLINARF / PLINARFB). */
  code: string;
  issuer: string;
  /** Saldo em trustlines que o issuer autorizou. */
  autorizado: Prisma.Decimal;
  /**
   * Trustlines autorizadas apenas a manter obrigações — o holder não pode
   * receber mais, mas o saldo existe e é um passivo do fundo.
   */
  autorizadoParaObrigacoes: Prisma.Decimal;
  /**
   * Trustlines desautorizadas: o saldo existe mas está congelado. Com
   * AUTH_REVOCABLE ligado, é onde um clawback em curso aparece. Continua
   * sendo passivo até ser efetivamente clawed back.
   */
  naoAutorizado: Prisma.Decimal;
  /** Em claimable balances, liquidity pools e contratos Soroban. */
  emTransito: Prisma.Decimal;
  /** Tudo que existe fora do issuer: emitido e não queimado. */
  totalEmitido: Prisma.Decimal;
  /**
   * Saldo do distributor. Token já cunhado mas ainda não vendido —
   * tesouraria, não passivo com investidor.
   */
  tesouraria: Prisma.Decimal;
  /**
   * `totalEmitido - tesouraria`: o que está em mãos de investidor. É o
   * denominador do NAV (ver `navPorTokenAsDecimal`).
   */
  circulante: Prisma.Decimal;
  /** Contagem de trustlines por estado de autorização, pra reconciliação. */
  contas: {
    autorizadas: number;
    autorizadasParaObrigacoes: number;
    naoAutorizadas: number;
  };
  /**
   * `true` quando existe saldo desautorizado. Não é erro — é sinal de que há
   * revogação ou clawback em curso, e o operador deve saber antes de publicar
   * um NAV.
   */
  temSaldoCongelado: boolean;
  /** Quando a leitura foi feita. Vai no snapshot ancorado (M5). */
  lidoEm: Date;
}

/**
 * Lê o supply de um asset emitido pela Plina direto do Horizon.
 *
 * **Falha fechada de propósito.** Se o Horizon não responde, o erro propaga
 * em vez de cair pro Postgres: um NAV calculado com o denominador antigo é o
 * bug que este módulo existe pra eliminar, e precificar emissão ou resgate com
 * ele seria pior que recusar a operação.
 *
 * Asset nunca emitido devolve tudo zerado (o Horizon não tem registro), não
 * erro — é o estado legítimo de um pool vazio.
 */
export async function fetchSupplyOnChain(input: {
  issuerPubkey: string;
  distributorPubkey: string;
  code?: string;
}): Promise<SupplyOnChain> {
  const code = input.code ?? assetCode;

  return withSpan(
    'stellar.supply',
    {
      'stellar.asset_code': code,
      'stellar.network': STELLAR_NETWORK,
    },
    async (span) => {
      const [page, saldoDistributor] = await Promise.all([
        horizon.assets().forCode(code).forIssuer(input.issuerPubkey).call(),
        getAssetBalance(input.distributorPubkey, code, input.issuerPubkey),
      ]);

      const record = page.records[0];
      const lidoEm = new Date();

      if (!record) {
        span.setAttribute('stellar.supply.total', '0');
        return {
          code,
          issuer: input.issuerPubkey,
          autorizado: ZERO,
          autorizadoParaObrigacoes: ZERO,
          naoAutorizado: ZERO,
          emTransito: ZERO,
          totalEmitido: ZERO,
          tesouraria: ZERO,
          circulante: ZERO,
          contas: {
            autorizadas: 0,
            autorizadasParaObrigacoes: 0,
            naoAutorizadas: 0,
          },
          temSaldoCongelado: false,
          lidoEm,
        };
      }

      const autorizado = dec(record.balances.authorized);
      const autorizadoParaObrigacoes = dec(
        record.balances.authorized_to_maintain_liabilities,
      );
      const naoAutorizado = dec(record.balances.unauthorized);
      const emTransito = dec(record.claimable_balances_amount)
        .plus(dec(record.liquidity_pools_amount))
        .plus(dec(record.contracts_amount));

      const totalEmitido = autorizado
        .plus(autorizadoParaObrigacoes)
        .plus(naoAutorizado)
        .plus(emTransito);

      const tesouraria = dec(saldoDistributor);
      // Clamp em zero: o distributor pode aparecer com saldo maior que o
      // total num instante de leitura não-atômica (duas chamadas ao Horizon).
      const circulante = Prisma.Decimal.max(totalEmitido.minus(tesouraria), ZERO);

      span.setAttribute('stellar.supply.total', totalEmitido.toString());
      span.setAttribute('stellar.supply.circulante', circulante.toString());

      return {
        code,
        issuer: input.issuerPubkey,
        autorizado,
        autorizadoParaObrigacoes,
        naoAutorizado,
        emTransito,
        totalEmitido,
        tesouraria,
        circulante,
        contas: {
          autorizadas: record.accounts.authorized,
          autorizadasParaObrigacoes:
            record.accounts.authorized_to_maintain_liabilities,
          naoAutorizadas: record.accounts.unauthorized,
        },
        temSaldoCongelado: naoAutorizado.gt(ZERO),
        lidoEm,
      };
    },
  );
}

/**
 * Lê o supply usando issuer e distributor do ambiente. Conveniência pros
 * callers que não têm as chaves em mão (rotas e páginas).
 */
export async function fetchSupplyOnChainFromEnv(
  code?: string,
): Promise<SupplyOnChain> {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) {
    throw new Error(
      'STELLAR_ISSUER_PUBLIC + STELLAR_DISTRIBUTOR_PUBLIC obrigatórios pra ler o supply on-chain.',
    );
  }
  return fetchSupplyOnChain({ issuerPubkey, distributorPubkey, code });
}
