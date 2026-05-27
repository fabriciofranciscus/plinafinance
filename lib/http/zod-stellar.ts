/**
 * Helpers Zod específicos pra inputs Stellar — usados por todos os routes
 * em /api/investidor/buy/*. Mantém a checagem de chave/XDR consistente
 * sem precisar um lib/schemas/ global.
 */
import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

export function stellarPubkey() {
  return z
    .string()
    .refine(
      (s) => StrKey.isValidEd25519PublicKey(s),
      'pubkey Ed25519 inválida',
    );
}

/** XDR base64. Tx envelopes da Stellar costumam ficar abaixo de ~6 KB; 8192 é folga. */
export function stellarXdr(max = 8192) {
  return z.string().min(1).max(max);
}

/** Assinatura Ed25519 em hex (64 bytes = 128 hex chars). */
export function stellarSignatureHex() {
  return z
    .string()
    .regex(/^[0-9a-fA-F]+$/, 'signatureHex deve ser hex')
    .min(2)
    .max(256);
}
