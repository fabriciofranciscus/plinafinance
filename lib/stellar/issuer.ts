import {
  AuthClawbackEnabledFlag,
  type AuthFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { buildAsset, horizon, warnIfBalanceBelowFloor } from './account';
import {
  DISTRIBUTOR_BALANCE_FLOOR,
  ISSUER_BALANCE_FLOOR,
  STELLAR_NETWORK,
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
  networkPassphrase,
} from './config';
import { assetCodeForClasse } from './classes';
import { getDynamicFee } from './fee';
import type { StellarSigner } from './signer';
import { withSpan } from '../observability/tracer';

/**
 * Wrappers Stellar usados pelo POC e pelo MVP.
 *
 * Política institucional (whitepaper §3.2 + §6.5):
 *   AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED no issuer.
 *   Clawback limitado a 4 hipóteses; cada acionamento deve registrar
 *   motivo + fundamento em audit log ANTES de chamar `executeClawback`.
 *
 * Regra do CLAUDE.md: DB só atualiza APÓS sucesso on-chain. Esse módulo
 * NÃO toca o DB — orquestração fica em `lib/services/*`.
 */

type SubmitResult = Horizon.HorizonApi.SubmitTransactionResponse;

async function buildSourceTx(
  source: StellarSigner,
  floor?: { xlm: string | number; label: string },
) {
  const account = await horizon.loadAccount(source.publicKey());
  if (floor) warnIfBalanceBelowFloor(account.balances, floor.xlm, floor.label);
  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  });
  return { source, builder };
}

async function sign(
  builder: TransactionBuilder,
  signers: StellarSigner[],
): Promise<SubmitResult> {
  const tx = builder.setTimeout(STELLAR_TX_TIMEOUT_SEC).build();
  signers.forEach((s) => s.sign(tx));
  return withSpan(
    'stellar.submit',
    { 'stellar.flow': 'issuer', 'stellar.network': STELLAR_NETWORK },
    async (span) => {
      const res = await horizon.submitTransaction(tx);
      span.setAttribute('stellar.tx_hash', res.hash);
      return res;
    },
  );
}

export async function configureIssuerFlags(
  issuer: StellarSigner,
  homeDomain?: string,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  // Bitmask OR de constantes numéricas vira `number`; o SDK tipa `setFlags`
  // como `AuthFlag`. Cast é necessário — TS não infere bitmasks combinados.
  const flags = (AuthRequiredFlag |
    AuthRevocableFlag |
    AuthClawbackEnabledFlag) as AuthFlag;

  builder.addOperation(
    Operation.setOptions({
      setFlags: flags,
      homeDomain,
    }),
  );
  return sign(builder, [source]);
}

export async function createTrustline(
  holder: StellarSigner,
  issuerPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(holder);
  builder.addOperation(
    Operation.changeTrust({ asset: buildAsset(issuerPubkey, code) }),
  );
  return sign(builder, [source]);
}

export async function authorizeTrustline(
  issuer: StellarSigner,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.setTrustLineFlags({
      trustor: holderPubkey,
      asset: buildAsset(source.publicKey(), code),
      flags: { authorized: true },
    }),
  );
  return sign(builder, [source]);
}

export async function revokeTrustline(
  issuer: StellarSigner,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.setTrustLineFlags({
      trustor: holderPubkey,
      asset: buildAsset(source.publicKey(), code),
      flags: { authorized: false },
    }),
  );
  return sign(builder, [source]);
}

export type IssueAssetErrorCode = 'ISSUE_CODE_UNKNOWN' | 'ISSUE_AMOUNT_INVALID';

/** Entrada recusada por `issueAsset` antes de qualquer rede ou assinatura. */
export class IssueAssetInputError extends Error {
  readonly code: IssueAssetErrorCode;

  constructor(code: IssueAssetErrorCode) {
    super(
      code === 'ISSUE_CODE_UNKNOWN'
        ? 'Emissão recusada: asset code ausente ou fora da Plina.'
        : 'Emissão recusada: amount precisa ser string > 0 com até 7 casas.',
    );
    this.name = 'IssueAssetInputError';
    this.code = code;
  }
}

/** Amount Stellar: inteiro de até 12 dígitos, opcionalmente com 1–7 casas. */
const ISSUE_AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;
const STELLAR_MAX_STROOPS = BigInt('9223372036854775807');

function amountEmStroops(amount: string): bigint {
  const [inteiro, frac = ''] = amount.split('.');
  return BigInt(inteiro) * BigInt(10_000_000) + BigInt(frac.padEnd(7, '0'));
}

function assertIssueInput(amount: unknown, code: unknown): void {
  const codesDaPlina = [assetCodeForClasse('SENIOR'), assetCodeForClasse('SUBORDINADA')];
  if (typeof code !== 'string' || !codesDaPlina.includes(code)) {
    throw new IssueAssetInputError('ISSUE_CODE_UNKNOWN');
  }
  if (typeof amount !== 'string' || !ISSUE_AMOUNT.test(amount)) {
    throw new IssueAssetInputError('ISSUE_AMOUNT_INVALID');
  }
  const stroops = amountEmStroops(amount);
  if (stroops <= BigInt(0) || stroops > STELLAR_MAX_STROOPS) {
    throw new IssueAssetInputError('ISSUE_AMOUNT_INVALID');
  }
}

/**
 * Emite tokens do issuer para uma conta autorizada (tipicamente distributor).
 * Idempotência: o caller deve garantir antes de chamar (lookup no banco por
 * `Cota.emissaoTxHash`).
 *
 * `code` é obrigatório (sem default): emitir a classe errada é erro de
 * dinheiro. Code fora da Plina, ou amount que não seja string > 0 com até 7
 * casas, é recusado com `IssueAssetInputError` antes de carregar a conta ou
 * assinar (fail-closed).
 */
export async function issueAsset(
  issuer: StellarSigner,
  destinationPubkey: string,
  amount: string,
  code: string,
): Promise<SubmitResult> {
  assertIssueInput(amount, code);
  const { source, builder } = await buildSourceTx(issuer, {
    xlm: ISSUER_BALANCE_FLOOR,
    label: 'issuer',
  });
  builder.addOperation(
    Operation.payment({
      destination: destinationPubkey,
      asset: buildAsset(source.publicKey(), code),
      amount,
    }),
  );
  return sign(builder, [source]);
}

export async function distribute(
  distributor: StellarSigner,
  issuerPubkey: string,
  destinationPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(distributor, {
    xlm: DISTRIBUTOR_BALANCE_FLOOR,
    label: 'distributor',
  });
  builder.addOperation(
    Operation.payment({
      destination: destinationPubkey,
      asset: buildAsset(issuerPubkey, code),
      amount,
    }),
  );
  return sign(builder, [source]);
}

/**
 * Executa clawback. Whitepaper §6.5: 4 hipóteses exclusivas.
 * O caller é responsável por persistir motivo + fundamento em EventoAudit
 * ANTES de chamar.
 */
export async function executeClawback(
  issuer: StellarSigner,
  fromPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.clawback({
      asset: buildAsset(source.publicKey(), code),
      from: fromPubkey,
      amount,
    }),
  );
  return sign(builder, [source]);
}
