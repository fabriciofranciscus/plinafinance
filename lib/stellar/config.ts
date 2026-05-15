import { Networks } from '@stellar/stellar-sdk';

/**
 * Configuração Stellar.
 *
 * Asset code on-chain é "PLINARF" — Stellar não permite hífen em asset codes
 * (AlphaNum4 ou AlphaNum12 com [a-zA-Z0-9] apenas). "PLINA-RF" é apenas branding
 * em material institucional, nunca on-chain.
 */

export type StellarNetwork = 'TESTNET' | 'PUBLIC';

export const STELLAR_NETWORK: StellarNetwork =
  (process.env.STELLAR_NETWORK as StellarNetwork) ?? 'TESTNET';

export const networkPassphrase =
  STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

export const horizonUrl =
  process.env.STELLAR_HORIZON_URL ??
  (STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org');

export const friendbotUrl = 'https://friendbot.stellar.org';

export const assetCode = process.env.ASSET_CODE ?? 'PLINARF';

const stellarExpertBase =
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';

export const txExplorerUrl = (hash: string) => `${stellarExpertBase}/tx/${hash}`;
export const accountExplorerUrl = (pubkey: string) =>
  `${stellarExpertBase}/account/${pubkey}`;
export const assetExplorerUrl = (issuerPubkey: string, code = assetCode) =>
  `${stellarExpertBase}/asset/${code}-${issuerPubkey}`;
