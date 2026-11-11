/**
 * Porta de KYC/onboarding do anchor — a única superfície que `lib/services`
 * enxerga. O serviço nunca importa `lib/anchors/etherfuse` direto: a escolha do
 * fornecedor concreto vive aqui (E2-2). `Ramp` (ordens on/off) continua
 * integração concreta e só vira porta no M4.
 */

import { EtherfuseClient } from './etherfuse';
import { resolveTesouroAsset } from './etherfuse/tesouro';

/** Operações de KYC/onboarding de que os serviços de domínio precisam. */
export type KycAnchor = Pick<
  EtherfuseClient,
  | 'createCustomer'
  | 'getKycUrl'
  | 'getKycStatus'
  | 'submitKycIdentity'
  | 'submitKycDocuments'
  | 'acceptElectronicSignature'
  | 'acceptTermsAndConditions'
  | 'registerPixBankAccount'
>;

/** Cliente de KYC do anchor configurado pelo ambiente (sandbox por padrão). */
export function kycAnchorFromEnv(): KycAnchor {
  const apiKey = process.env.ETHERFUSE_API_KEY;
  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  if (!apiKey) {
    throw new Error('ETHERFUSE_API_KEY ausente.');
  }
  return new EtherfuseClient({ apiKey, baseUrl });
}

export interface BridgeAsset {
  code: string;
  issuer: string;
  identifier: string;
}

/** Ativo-ponte (hoje TESOURO) resolvido no anchor; cacheado por processo. */
export function resolveBridgeAsset(publicKeyHint: string): Promise<BridgeAsset> {
  return resolveTesouroAsset(publicKeyHint);
}
