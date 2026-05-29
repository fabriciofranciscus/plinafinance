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

/**
 * Emite tokens do issuer para uma conta autorizada (tipicamente distributor).
 * Idempotência: o caller deve garantir antes de chamar (lookup no banco por
 * `Cota.emissaoTxHash`).
 */
export async function issueAsset(
  issuer: StellarSigner,
  destinationPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
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
