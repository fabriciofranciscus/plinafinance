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
 *
 * Subimos pra 120s (do 60s original do F-14) depois que PR #3 mostrou que
 * 60s causava tx_too_late no submit quando o usuário leva mais tempo na
 * confirm screen + assinatura via Privy. 120s é o teto do range permitido
 * pelo audit, então ainda preserva a mitigação de replay.
 */
export const STELLAR_TX_TIMEOUT_SEC = 120;

/**
 * Funder mainnet (F-08). Em PUBLIC, `fundAccountIfNeeded` constrói um
 * `createAccount` op a partir dessa conta — não há friendbot em produção.
 * Em TESTNET esses envs são ignorados.
 */
export const STELLAR_FUNDER_SECRET = process.env.STELLAR_FUNDER_SECRET ?? '';
export const STELLAR_FUNDER_PUBLIC = process.env.STELLAR_FUNDER_PUBLIC ?? '';
export const STELLAR_FUNDER_STARTING_BALANCE =
  process.env.STELLAR_FUNDER_STARTING_BALANCE ?? '2';

/**
 * N-09: cap diário global de funding em mainnet. Contado via EventoAudit
 * com acao=WALLET_FUNDED. Excedido → throw (operador precisa bumpar
 * manualmente após investigar). Default conservador.
 */
export const FUNDER_DAILY_CAP = Number(process.env.FUNDER_DAILY_CAP ?? '100');

/**
 * N-09: piso de XLM do funder pra warn (não bloqueia). Operador vê no
 * log e bumpa antes de drenar. Default cobre ~25 contas a 2 XLM.
 */
export const FUNDER_BALANCE_FLOOR = process.env.FUNDER_BALANCE_FLOOR ?? '50';

/**
 * F-M0-4: pisos de XLM de issuer e distributor pra warn (não bloqueia, mesmo
 * padrão do funder). Issuer/distributor pagam fee em toda emissão/distribuição;
 * sem alarme, podem secar em mainnet sem aviso. Operador vê no log e recarrega.
 */
export const ISSUER_BALANCE_FLOOR = process.env.ISSUER_BALANCE_FLOOR ?? '5';
export const DISTRIBUTOR_BALANCE_FLOOR =
  process.env.DISTRIBUTOR_BALANCE_FLOOR ?? '5';

const stellarExpertBase =
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';

export const txExplorerUrl = (hash: string) => `${stellarExpertBase}/tx/${hash}`;
export const accountExplorerUrl = (pubkey: string) =>
  `${stellarExpertBase}/account/${pubkey}`;
export const assetExplorerUrl = (issuerPubkey: string, code = assetCode) =>
  `${stellarExpertBase}/asset/${code}-${issuerPubkey}`;
