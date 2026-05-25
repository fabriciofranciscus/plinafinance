import {
  AuthClawbackEnabledFlag,
  type AuthFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { buildAsset, horizon } from './account';
import { STELLAR_TX_TIMEOUT_SEC, assetCode, networkPassphrase } from './config';
import { getDynamicFee } from './fee';

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

async function buildSourceTx(sourceSecret: string) {
  const source = Keypair.fromSecret(sourceSecret);
  const account = await horizon.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  });
  return { source, builder };
}

async function sign(
  builder: TransactionBuilder,
  signers: Keypair[],
): Promise<SubmitResult> {
  const tx = builder.setTimeout(STELLAR_TX_TIMEOUT_SEC).build();
  signers.forEach((s) => tx.sign(s));
  return horizon.submitTransaction(tx);
}

export async function configureIssuerFlags(
  issuerSecret: string,
  homeDomain?: string,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuerSecret);
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
  holderSecret: string,
  issuerPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(holderSecret);
  builder.addOperation(
    Operation.changeTrust({ asset: buildAsset(issuerPubkey, code) }),
  );
  return sign(builder, [source]);
}

export async function authorizeTrustline(
  issuerSecret: string,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuerSecret);
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
  issuerSecret: string,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuerSecret);
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
  issuerSecret: string,
  destinationPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuerSecret);
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
  distributorSecret: string,
  issuerPubkey: string,
  destinationPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(distributorSecret);
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
  issuerSecret: string,
  fromPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuerSecret);
  builder.addOperation(
    Operation.clawback({
      asset: buildAsset(source.publicKey(), code),
      from: fromPubkey,
      amount,
    }),
  );
  return sign(builder, [source]);
}
