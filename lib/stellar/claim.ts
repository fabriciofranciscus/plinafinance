/**
 * Claim do claimable balance do anchor com abertura de trustline (E2-1).
 *
 * O anchor (Etherfuse) entrega o ativo-ponte num claimable balance. A carteira
 * nova do investidor não tem trustline para ele, e o claim sozinho falha com
 * `op_no_trust`. A execução de referência (`scripts/smoke-investidor.ts`,
 * testnet 2026-09-28, tx 50a2f198…a311) usou um XDR com duas operações:
 * `changeTrust(ativo, limite máximo)` + `claimClaimableBalance(id)`, source =
 * investidor. Este módulo monta esse XDR do nosso lado, a partir do ledger,
 * para não depender do XDR do anchor (que pode ter expirado ou ficado com a
 * sequência velha).
 *
 * Também cobre a reserva de XLM: cada trustline nova prende 0,5 XLM. O anchor
 * deixa a carteira com o mínimo; a 2ª trustline (PLINARF) precisa de aporte
 * do funder da Plina (P6). Aqui só calculamos e montamos — assinar e submeter
 * o aporte, com teto diário, é do serviço que chama.
 */

import { Asset, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import { horizon } from './account';
import { STELLAR_TX_TIMEOUT_SEC, networkPassphrase } from './config';
import { getDynamicFee } from './fee';
import { buildClaimClaimableBalanceXdr } from './transactions';

/** Reserva base da rede (0,5 XLM desde o protocolo 11). */
export const BASE_RESERVE_XLM = '0.5';
/**
 * Folga para fees: 2 operações no teto do `getDynamicFee` (100k stroops cada).
 */
export const FEE_MARGEM_XLM = '0.02';

export type ClaimErrorCode =
  | 'CB_NOT_FOUND'
  | 'NOT_CLAIMANT'
  | 'ACCOUNT_MISSING'
  | 'RESERVA_INSUFICIENTE'
  | 'APORTE_FORA_DO_TETO';

const MENSAGENS: Record<ClaimErrorCode, string> = {
  CB_NOT_FOUND:
    'Claimable balance não encontrado no ledger (pode já ter sido reclamado).',
  NOT_CLAIMANT: 'A carteira não é claimant deste claimable balance.',
  ACCOUNT_MISSING: 'A carteira ainda não existe no ledger.',
  RESERVA_INSUFICIENTE:
    'A carteira não tem XLM para a reserva da trustline; é preciso aporte.',
  APORTE_FORA_DO_TETO: 'Valor de aporte fora do teto permitido.',
};

/** Erro tipado do fluxo de claim. Mensagens constantes, sem segredo nem env. */
export class ClaimError extends Error {
  readonly code: ClaimErrorCode;
  /** Só em RESERVA_INSUFICIENTE: XLM que falta, 7 casas. */
  readonly aporteXlm?: string;

  constructor(code: ClaimErrorCode, aporteXlm?: string) {
    super(MENSAGENS[code]);
    this.name = 'ClaimError';
    this.code = code;
    this.aporteXlm = aporteXlm;
  }
}

/**
 * `true` quando o XDR já passou (ou está a `margemSec` de passar) do
 * `maxTime`. Sem limite de tempo (`maxTime` 0) nunca expira. O Horizon
 * recusa tx expirada com `tx_too_late`; a margem evita mandar o investidor
 * assinar um XDR que vence no caminho.
 */
export function xdrExpirado(
  xdr: string,
  agoraSec: number = Math.floor(Date.now() / 1000),
  margemSec = 5,
): boolean {
  const tx = new Transaction(xdr, networkPassphrase);
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (!maxTime) return false;
  return agoraSec >= maxTime - margemSec;
}

/** `true` quando o erro do submit é `tx_too_late` (XDR expirou). */
export function erroDeXdrExpirado(err: unknown): boolean {
  const codes = (
    err as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } }
  )?.response?.data?.extras?.result_codes;
  return codes?.transaction === 'tx_too_late';
}

interface ContaParaReserva {
  balances: ReadonlyArray<{
    asset_type: string;
    balance: string;
    selling_liabilities?: string;
  }>;
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

/**
 * XLM que falta para a conta abrir `novasTrustlines` e pagar as fees.
 * mínimo = (2 + subentries + novas + patrocinando − patrocinadas) × 0,5.
 * Disponível = saldo nativo − selling liabilities. Arredonda para cima.
 */
export function aporteNecessarioXlm(
  conta: ContaParaReserva,
  novasTrustlines: number,
  feeMargemXlm: string = FEE_MARGEM_XLM,
): string {
  const D = Prisma.Decimal;
  const nativo = conta.balances.find((b) => b.asset_type === 'native');
  const disponivel = new D(nativo?.balance ?? '0').minus(
    new D(nativo?.selling_liabilities ?? '0'),
  );
  const entradas =
    2 +
    conta.subentry_count +
    novasTrustlines +
    (conta.num_sponsoring ?? 0) -
    (conta.num_sponsored ?? 0);
  const minimo = new D(BASE_RESERVE_XLM).mul(entradas).plus(new D(feeMargemXlm));
  const falta = D.max(minimo.minus(disponivel), 0);
  return falta.toDecimalPlaces(7, D.ROUND_UP).toFixed(7);
}

/** Teto do aporte: reserva das trustlines novas + folga de fee. */
function tetoAporteXlm(novasTrustlines: number): Prisma.Decimal {
  return new Prisma.Decimal(BASE_RESERVE_XLM).mul(novasTrustlines).plus('0.1');
}

/**
 * Monta o aporte de XLM do funder para o investidor cobrir a reserva da
 * trustline nova. Source = funder; quem chama assina com o funder e aplica o
 * teto diário (ver `fundAccountIfNeeded`). Recusa valor ≤ 0 ou acima do teto
 * — o aporte não é canal para mandar XLM arbitrário a uma carteira.
 */
export async function buildAporteReservaXdr(input: {
  funderPubkey: string;
  investorPubkey: string;
  amountXlm: string;
  novasTrustlines?: number;
}): Promise<{ xdr: string; hashHex: string }> {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(input.amountXlm);
  } catch {
    throw new ClaimError('APORTE_FORA_DO_TETO');
  }
  if (amount.lte(0) || amount.gt(tetoAporteXlm(input.novasTrustlines ?? 1))) {
    throw new ClaimError('APORTE_FORA_DO_TETO');
  }
  const funder = await horizon.loadAccount(input.funderPubkey);
  const tx = new TransactionBuilder(funder, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: input.investorPubkey,
        asset: Asset.native(),
        amount: amount.toFixed(7),
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

function assetDoHorizon(asset: string): Asset {
  if (asset === 'native') return Asset.native();
  const [code, issuer] = asset.split(':');
  return new Asset(code, issuer);
}

function temTrustline(
  balances: ReadonlyArray<{ asset_code?: string; asset_issuer?: string }>,
  asset: Asset,
): boolean {
  return balances.some(
    (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );
}

function is404(err: unknown): boolean {
  return (
    (err as { response?: { status?: number } })?.response?.status === 404 ||
    (err as { name?: string })?.name === 'NotFoundError'
  );
}

/**
 * O XDR anterior ainda serve? Mesmo source, não expirado, sequência = conta+1
 * e exatamente as operações esperadas (mesmo CB, mesma trustline).
 */
function xdrAnteriorServe(
  xdr: string,
  esperado: {
    investorPubkey: string;
    balanceId: string;
    trustAsset?: Asset;
    sequenciaConta: string;
  },
): boolean {
  let tx: Transaction;
  try {
    tx = new Transaction(xdr, networkPassphrase);
  } catch {
    return false;
  }
  if (tx.source !== esperado.investorPubkey) return false;
  if (xdrExpirado(xdr)) return false;
  if (BigInt(tx.sequence) !== BigInt(esperado.sequenciaConta) + BigInt(1)) return false;

  const ops = tx.operations;
  const n = esperado.trustAsset ? 2 : 1;
  if (ops.length !== n) return false;
  if (esperado.trustAsset) {
    const t = ops[0];
    if (t.type !== 'changeTrust') return false;
    const line = t.line;
    if (!(line instanceof Asset) || !line.equals(esperado.trustAsset)) return false;
  }
  const c = ops[n - 1];
  return c.type === 'claimClaimableBalance' && c.balanceId === esperado.balanceId;
}

export interface ClaimPreparado {
  xdr: string;
  hashHex: string;
  operacoes: Array<'changeTrust' | 'claimClaimableBalance'>;
  /** Asset do CB como o Horizon devolve (`CODE:ISSUER`). */
  asset: string;
  amount: string;
  /** `true` quando havia `xdrAnterior` e ele foi substituído. */
  regenerado: boolean;
}

/**
 * Prepara o XDR do claim a partir do ledger:
 *  1. lê o CB no Horizon (404 → `CB_NOT_FOUND`; o caller reconcilia pelo hash
 *     do XDR anterior com `fetchTransactionByHash`, pode já ter sido aplicado);
 *  2. exige que a carteira seja claimant;
 *  3. inclui `changeTrust` só se a trustline faltar, e então exige reserva
 *     de XLM (`RESERVA_INSUFICIENTE` com o aporte exato);
 *  4. reaproveita `xdrAnterior` se ainda vale; senão regenera (expirado,
 *     sequência velha ou operações diferentes).
 */
export async function prepararClaimXdr(input: {
  investorPubkey: string;
  balanceId: string;
  xdrAnterior?: string;
}): Promise<ClaimPreparado> {
  let cb: { asset: string; amount: string; claimants: Array<{ destination: string }> };
  try {
    cb = await horizon.claimableBalances().claimableBalance(input.balanceId).call();
  } catch (err) {
    if (is404(err)) throw new ClaimError('CB_NOT_FOUND');
    throw err;
  }
  if (!cb.claimants.some((c) => c.destination === input.investorPubkey)) {
    throw new ClaimError('NOT_CLAIMANT');
  }

  let conta: Awaited<ReturnType<typeof horizon.loadAccount>>;
  try {
    conta = await horizon.loadAccount(input.investorPubkey);
  } catch (err) {
    if (is404(err)) throw new ClaimError('ACCOUNT_MISSING');
    throw err;
  }

  const asset = assetDoHorizon(cb.asset);
  const precisaTrust =
    !asset.isNative() &&
    !temTrustline(
      conta.balances as ReadonlyArray<{ asset_code?: string; asset_issuer?: string }>,
      asset,
    );
  if (precisaTrust) {
    const falta = aporteNecessarioXlm(conta as unknown as ContaParaReserva, 1);
    if (new Prisma.Decimal(falta).gt(0)) {
      throw new ClaimError('RESERVA_INSUFICIENTE', falta);
    }
  }
  const trustAsset = precisaTrust ? asset : undefined;
  const operacoes: ClaimPreparado['operacoes'] = precisaTrust
    ? ['changeTrust', 'claimClaimableBalance']
    : ['claimClaimableBalance'];

  if (
    input.xdrAnterior &&
    xdrAnteriorServe(input.xdrAnterior, {
      investorPubkey: input.investorPubkey,
      balanceId: input.balanceId,
      trustAsset,
      sequenciaConta: conta.sequenceNumber(),
    })
  ) {
    const tx = new Transaction(input.xdrAnterior, networkPassphrase);
    return {
      xdr: input.xdrAnterior,
      hashHex: '0x' + tx.hash().toString('hex'),
      operacoes,
      asset: cb.asset,
      amount: cb.amount,
      regenerado: false,
    };
  }

  const { xdr, hashHex } = await buildClaimClaimableBalanceXdr({
    investorPubkey: input.investorPubkey,
    balanceId: input.balanceId,
    trustAsset,
  });
  return {
    xdr,
    hashHex,
    operacoes,
    asset: cb.asset,
    amount: cb.amount,
    regenerado: Boolean(input.xdrAnterior),
  };
}
