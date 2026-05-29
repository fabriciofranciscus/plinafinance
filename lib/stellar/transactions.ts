/**
 * Helpers de Transaction Building/Submission compatíveis com Privy rawSign.
 *
 * Padrão Yalla (`apps/api/src/services/stellar.service.ts`):
 *   - `buildXdrAndHash(...)`: monta tx, retorna { xdr, hashHex }. hashHex é o
 *     SHA-256 que Privy `useSignRawHash` assina.
 *   - `submitWithPrivySignature(...)`: reconstrói tx do XDR, anexa signature
 *     base64 do endereço do usuário, submete.
 *
 * Usar pra qualquer tx assinada pelo investidor (trustline + swap).
 */

import {
  Asset,
  Horizon,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { buildAsset, horizon } from './account';
import {
  STELLAR_NETWORK,
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
  networkPassphrase,
} from './config';
import { getDynamicFee } from './fee';
import { privySignatureToBase64 } from '../wallet/privy';
import { withSpan } from '../observability/tracer';

type SubmitResult = Horizon.HorizonApi.SubmitTransactionResponse;

/**
 * Monta tx de trustline pro investidor estabelecer PLINARF, retorna XDR + hash.
 * Source = investidor (paga a tx). Não assina aqui — frontend assina via Privy.
 */
export async function buildTrustlineXdr(
  investorPubkey: string,
  issuerPubkey: string,
  code: string = assetCode,
): Promise<{ xdr: string; hashHex: string }> {
  const account = await horizon.loadAccount(investorPubkey);
  const tx = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: buildAsset(issuerPubkey, code) }))
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

/**
 * Monta tx de swap atômico: investidor envia TESOURO pro distributor Plina +
 * distributor devolve PLINARF pro investidor. Dois payments no mesmo envelope.
 *
 * Source = investidor (paga fee). Investidor + distributor assinam.
 * Distributor é assinado server-side com STELLAR_DISTRIBUTOR_SECRET.
 * Investidor assina via Privy (frontend).
 */
export async function buildSwapBridgeForPlinarfXdr(input: {
  investorPubkey: string;
  bridgeAsset: Asset;
  bridgeAmount: string;
  plinarfAmount: string;
  issuerPubkey: string;
  distributorPubkey: string;
  memo?: string;
}): Promise<{ xdr: string; hashHex: string }> {
  const account = await horizon.loadAccount(input.investorPubkey);
  const plinarf = buildAsset(input.issuerPubkey);

  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        source: input.investorPubkey,
        destination: input.distributorPubkey,
        asset: input.bridgeAsset,
        amount: input.bridgeAmount,
      }),
    )
    .addOperation(
      Operation.payment({
        source: input.distributorPubkey,
        destination: input.investorPubkey,
        asset: plinarf,
        amount: input.plinarfAmount,
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC);

  if (input.memo) builder.addMemo(Memo.text(input.memo.slice(0, 28)));

  const tx = builder.build();
  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

/**
 * Monta tx de ClaimClaimableBalance pro investor reclamar um
 * ClaimableBalance criado pela anchor (Etherfuse PIX/BRL paga TESOURO via
 * CB depois do onramp completed — PLINA-MOD-007).
 * Source = investor (paga fee). Investor assina via Privy.
 */
export async function buildClaimClaimableBalanceXdr(input: {
  investorPubkey: string;
  balanceId: string;
}): Promise<{ xdr: string; hashHex: string }> {
  const account = await horizon.loadAccount(input.investorPubkey);
  const tx = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.claimClaimableBalance({ balanceId: input.balanceId }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

/**
 * Monta tx de Payment do investor pra um destino arbitrário (usado pelo
 * mock-burn do off-ramp: investor consome TESOURO mandando pro distributor
 * Plina como "queima simbólica" em sandbox sem Etherfuse real).
 * Source = investor (paga fee). Investor assina via Privy.
 */
export async function buildPaymentXdr(input: {
  investorPubkey: string;
  destination: string;
  asset: Asset;
  amount: string;
  memo?: string;
}): Promise<{ xdr: string; hashHex: string }> {
  const account = await horizon.loadAccount(input.investorPubkey);
  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        source: input.investorPubkey,
        destination: input.destination,
        asset: input.asset,
        amount: input.amount,
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC);

  if (input.memo) builder.addMemo(Memo.text(input.memo.slice(0, 28)));

  const tx = builder.build();
  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

/**
 * Submete tx assinada pelo investidor via Privy.
 * Para tx que precisa de signature adicional (ex: distributor), passar
 * `extraSigners` com pubkey + base64 signature.
 */
export async function submitWithPrivySignature(input: {
  xdr: string;
  investorPubkey: string;
  /** Signature do Privy em hex (0x + 128 chars). */
  investorSignatureHex: string;
  /** Signatures extras já em base64 (ex: distributor). */
  extraSignatures?: Array<{ pubkey: string; sigBase64: string }>;
}): Promise<SubmitResult> {
  const tx = new Transaction(input.xdr, networkPassphrase);
  tx.addSignature(
    input.investorPubkey,
    privySignatureToBase64(input.investorSignatureHex),
  );
  for (const extra of input.extraSignatures ?? []) {
    tx.addSignature(extra.pubkey, extra.sigBase64);
  }
  return withSpan(
    'stellar.submit',
    { 'stellar.flow': 'investor', 'stellar.network': STELLAR_NETWORK },
    async (span) => {
      const res = await horizon.submitTransaction(tx);
      span.setAttribute('stellar.tx_hash', res.hash);
      return res;
    },
  );
}

/**
 * Helper: pré-assina uma tx com uma chave server-side (issuer ou distributor)
 * e retorna a signature base64 pronta pra usar em `submitWithPrivySignature.extraSignatures`.
 *
 * Útil pra: investidor assina o swap via Privy, distributor já tem signature
 * pré-computada server-side anexada ANTES de submeter.
 */
import type { StellarSigner } from './signer';
export function preSignWithSigner(
  signer: StellarSigner,
  xdr: string,
): {
  pubkey: string;
  sigBase64: string;
} {
  const tx = new Transaction(xdr, networkPassphrase);
  return { pubkey: signer.publicKey(), sigBase64: signer.signatureBase64(tx) };
}
