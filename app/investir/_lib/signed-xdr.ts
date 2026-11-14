/**
 * Anexa a assinatura do investidor ao envelope do swap (N1).
 *
 * O build devolve o XDR sem nenhuma assinatura da Plina; o investidor assina o
 * `hashHex` com a wallet (Privy `signRawHash`, Ed25519 em hex) e o cliente
 * manda só `{ quoteId, signedXdr }`. A Plina assina no submit, depois de
 * validar o envelope contra a cotação.
 *
 * Só monta o envelope: a verificação da assinatura é do servidor/Horizon (o
 * hash depende da rede, que o cliente não conhece). Não toca em chave nenhuma.
 */

import { StrKey, xdr } from '@stellar/stellar-sdk';

const SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/;

export function attachInvestorSignature(
  xdrBase64: string,
  investorPubkey: string,
  signatureHex: string,
): string {
  const hex = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (!SIGNATURE_HEX.test(hex)) {
    throw new Error('Assinatura inválida: esperado Ed25519 de 64 bytes em hex.');
  }
  if (!StrKey.isValidEd25519PublicKey(investorPubkey)) {
    throw new Error('Endereço Stellar inválido (pubkey).');
  }

  const envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) {
    throw new Error('Envelope inesperado: esperado transação v1.');
  }

  const raw = StrKey.decodeEd25519PublicKey(investorPubkey);
  const v1 = envelope.v1();
  v1.signatures([
    ...v1.signatures(),
    new xdr.DecoratedSignature({
      hint: raw.subarray(raw.length - 4),
      signature: Buffer.from(hex, 'hex'),
    }),
  ]);
  return envelope.toXDR('base64');
}
