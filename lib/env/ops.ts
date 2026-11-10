/**
 * Configurações operacionais obrigatórias do M2/M3.
 *
 * Os getters centralizam a leitura e falham fechados sem expor no erro o nome
 * da variável ou o valor configurado.
 */
import { StrKey } from '@stellar/stellar-sdk';

const POSITION_UNAVAILABLE =
  'Configuração da posição da Plina indisponível.';
const WEBHOOK_UNAVAILABLE = 'Configuração do webhook indisponível.';

export function getStellarPlinaPositionPublic(): string {
  const value = process.env.STELLAR_PLINA_POSITION_PUBLIC?.trim();
  if (!value || !StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(POSITION_UNAVAILABLE);
  }
  return value;
}

export function getAnchorWebhookSecret(): string {
  const value = process.env.ANCHOR_WEBHOOK_SECRET;
  if (!value || !value.trim()) {
    throw new Error(WEBHOOK_UNAVAILABLE);
  }
  return value;
}
