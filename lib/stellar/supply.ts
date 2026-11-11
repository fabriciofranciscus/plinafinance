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

import { Prisma, type ClassePLINARF } from '@prisma/client';
import { getAssetBalance, horizon } from './account';
import { assetCodeForClasse } from './classes';
import { STELLAR_NETWORK } from './config';
import { withSpan } from '../observability/tracer';

const ZERO = new Prisma.Decimal(0);

function dec(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export type SupplyErrorCode = 'SUPPLY_CONFIG_MISSING' | 'SUPPLY_ASSET_UNKNOWN';

/**
 * Erro de configuração da leitura de supply. A mensagem é **constante** e não
 * cita variáveis de ambiente: ela pode subir até uma resposta HTTP pública, e
 * nome de env é mapa da infraestrutura. O detalhe fica em `code`.
 */
export class SupplyConfigError extends Error {
  readonly code: SupplyErrorCode;

  constructor(code: SupplyErrorCode) {
    super(
      code === 'SUPPLY_ASSET_UNKNOWN'
        ? 'Leitura de supply recusada: asset não pertence à Plina.'
        : 'Leitura de supply indisponível: configuração do ledger incompleta.',
    );
    this.name = 'SupplyConfigError';
    this.code = code;
  }
}

/** Supply das duas classes, lido no mesmo instante lógico. */
export interface SupplyDasClasses {
  senior: SupplyOnChain;
  subordinada: SupplyOnChain;
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
  /**
   * Obrigatório: sem default. O default implícito em PLINARF fazia o resgate
   * dividir pelo supply da Sênior mesmo quando a cotação era de outra classe.
   */
  code: string;
}): Promise<SupplyOnChain> {
  const { code } = input;
  if (!code) throw new SupplyConfigError('SUPPLY_ASSET_UNKNOWN');

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

function chavesDoAmbiente(): { issuerPubkey: string; distributorPubkey: string } {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) {
    throw new SupplyConfigError('SUPPLY_CONFIG_MISSING');
  }
  return { issuerPubkey, distributorPubkey };
}

/** Codes que a Plina emite, na fonte única (`classes.ts`). */
function codesDaPlina(): string[] {
  return [assetCodeForClasse('SENIOR'), assetCodeForClasse('SUBORDINADA')];
}

/**
 * Supply de um asset da Plina, com issuer e distributor do ambiente. Recusa
 * code que não seja de uma classe da Plina antes de ir ao Horizon.
 */
export async function fetchSupplyDoAsset(code: string): Promise<SupplyOnChain> {
  if (!codesDaPlina().includes(code)) {
    throw new SupplyConfigError('SUPPLY_ASSET_UNKNOWN');
  }
  return fetchSupplyOnChain({ ...chavesDoAmbiente(), code });
}

/** Supply da classe; o asset code vem de `assetCodeForClasse` (fonte única). */
export async function fetchSupplyDaClasse(
  classe: ClassePLINARF,
): Promise<SupplyOnChain> {
  return fetchSupplyDoAsset(assetCodeForClasse(classe));
}

/**
 * Supply das duas classes em paralelo. Falha fechada: se qualquer leitura
 * falhar, a chamada inteira falha — nunca devolve só uma classe.
 */
export async function fetchSupplyDasClasses(): Promise<SupplyDasClasses> {
  const [senior, subordinada] = await Promise.all([
    fetchSupplyDaClasse('SENIOR'),
    fetchSupplyDaClasse('SUBORDINADA'),
  ]);
  return { senior, subordinada };
}

/**
 * @deprecated Use `fetchSupplyDoAsset`, `fetchSupplyDaClasse` ou
 * `fetchSupplyDasClasses`. Mantida só para os callers atuais compilarem
 * durante a migração (M1-2); sem `code` lê a Sênior, como antes; code fora da
 * Plina é recusado.
 */
export async function fetchSupplyOnChainFromEnv(
  code?: string,
): Promise<SupplyOnChain> {
  return fetchSupplyDoAsset(code ?? assetCodeForClasse('SENIOR'));
}

/**
 * Saldo real do distributor num asset da Plina (TES-1). Só leitura: nada é
 * queimado nem movido. Lê só a conta do distributor — não depende do `/assets`
 * agregado (Horizon EOL).
 */
export interface SaldoTesouraria {
  code: string;
  issuer: string;
  distributor: string;
  /** Saldo do distributor nesse asset; zero sem trustline. */
  saldo: Prisma.Decimal;
  temTrustline: boolean;
  /** Trustline autorizada pelo issuer (AUTH_REQUIRED). */
  autorizada: boolean;
  lidoEm: Date;
}

export interface SaldoTesourariaDasClasses {
  senior: SaldoTesouraria;
  subordinada: SaldoTesouraria;
}

type BalanceLine = {
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  is_authorized?: boolean;
};

function saldoNaConta(
  balances: ReadonlyArray<BalanceLine>,
  code: string,
  chaves: { issuerPubkey: string; distributorPubkey: string },
  lidoEm: Date,
): SaldoTesouraria {
  const linha = balances.find(
    (b) => b.asset_code === code && b.asset_issuer === chaves.issuerPubkey,
  );
  return {
    code,
    issuer: chaves.issuerPubkey,
    distributor: chaves.distributorPubkey,
    saldo: linha ? dec(linha.balance) : ZERO,
    temTrustline: Boolean(linha),
    autorizada: linha?.is_authorized === true,
    lidoEm,
  };
}

async function balancesDoDistributor(distributorPubkey: string) {
  const conta = await horizon.loadAccount(distributorPubkey);
  return conta.balances as ReadonlyArray<BalanceLine>;
}

/** Saldo do distributor num code da Plina. Code fora da Plina é recusado. */
export async function fetchSaldoTesouraria(code: string): Promise<SaldoTesouraria> {
  if (!codesDaPlina().includes(code)) {
    throw new SupplyConfigError('SUPPLY_ASSET_UNKNOWN');
  }
  const chaves = chavesDoAmbiente();
  const balances = await balancesDoDistributor(chaves.distributorPubkey);
  return saldoNaConta(balances, code, chaves, new Date());
}

/** Saldo do distributor nas duas classes, numa leitura só da conta. */
export async function fetchSaldoTesourariaDasClasses(): Promise<SaldoTesourariaDasClasses> {
  const chaves = chavesDoAmbiente();
  const balances = await balancesDoDistributor(chaves.distributorPubkey);
  const lidoEm = new Date();
  return {
    senior: saldoNaConta(balances, assetCodeForClasse('SENIOR'), chaves, lidoEm),
    subordinada: saldoNaConta(balances, assetCodeForClasse('SUBORDINADA'), chaves, lidoEm),
  };
}
