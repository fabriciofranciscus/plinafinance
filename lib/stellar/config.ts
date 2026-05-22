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

/**
 * Timeout em segundos pra todas as txs Stellar (Memo.hash, trustline, swap,
 * liquidação). Janela curta limita replay caso a sig vaze antes do submit
 * (audit F-14). Tem que estar em [60, 120].
 */
export const STELLAR_TX_TIMEOUT_SEC = 60;

/**
 * Funder mainnet (F-08). Em PUBLIC, `fundAccountIfNeeded` constrói um
 * `createAccount` op a partir dessa conta — não há friendbot em produção.
 * Em TESTNET esses envs são ignorados.
 */
export const STELLAR_FUNDER_SECRET = process.env.STELLAR_FUNDER_SECRET ?? '';
export const STELLAR_FUNDER_PUBLIC = process.env.STELLAR_FUNDER_PUBLIC ?? '';
export const STELLAR_FUNDER_STARTING_BALANCE =
  process.env.STELLAR_FUNDER_STARTING_BALANCE ?? '2';

const stellarExpertBase =
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';

export const txExplorerUrl = (hash: string) => `${stellarExpertBase}/tx/${hash}`;
export const accountExplorerUrl = (pubkey: string) =>
  `${stellarExpertBase}/account/${pubkey}`;
export const assetExplorerUrl = (issuerPubkey: string, code = assetCode) =>
  `${stellarExpertBase}/asset/${code}-${issuerPubkey}`;
