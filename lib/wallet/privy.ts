/**
 * Privy server-side wrapper.
 *
 * Padrão Yalla. Stellar é **Tier 2** na Privy → NÃO tem toggle no dashboard
 * pra auto-create-on-login. Cliente chama programaticamente após login:
 *
 *     import { useCreateWallet } from '@privy-io/react-auth/extended-chains';
 *     await createWallet({ chainType: 'stellar' });
 *
 * Após isso o endereço aparece em `user.linkedAccounts` com prefixo 'G'.
 * Backend extrai daí. Wallet creation **não acontece server-side** no fluxo
 * normal (pode-se, via `privy.wallets().create()`, mas pra login UX o
 * client-side é mais limpo).
 *
 * Assinatura: frontend chama `useSignRawHash({chainType:'stellar', hash})`,
 * recebe signature `0x...` hex (64 bytes Ed25519), backend converte pra base64
 * e usa `transaction.addSignature(stellarAddress, sigBase64)`.
 *
 * Whitepaper §6.6 / ARCHITECTURE §3.6 — UX institucional sem extensão browser.
 */

import { PrivyClient } from '@privy-io/server-auth';

let _privy: PrivyClient | null = null;

/** Singleton PrivyClient. Falha rápido se env faltar. */
export function getPrivyClient(): PrivyClient {
  if (_privy) return _privy;

  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('PRIVY_APP_ID e PRIVY_APP_SECRET precisam estar setados.');
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

export interface PrivyLinkedAccount {
  type: string;
  address?: string;
  email?: string;
  chainType?: string;
}

export interface PrivyUserClaims {
  /** Privy user ID (estável, use como FK em `Investidor.privyId`). */
  userId: string;
  email?: string;
  stellarAddress: string;
}

/**
 * Verifica JWT do Privy e retorna claims úteis. Tira o endereço Stellar dos
 * `linkedAccounts` (qualquer entry com type=wallet, chainType=stellar OU
 * address começando com 'G').
 *
 * Throws com mensagem clara se token inválido ou Stellar wallet ausente.
 */
export async function verifyPrivyTokenAndExtract(
  accessToken: string,
): Promise<PrivyUserClaims> {
  const privy = getPrivyClient();
  const claims = await privy.verifyAuthToken(accessToken);

  const privyUser = await privy.getUserById(claims.userId);
  const linkedAccounts = (privyUser.linkedAccounts ?? []) as PrivyLinkedAccount[];

  const stellarAccount = linkedAccounts.find(
    (a) =>
      a.type === 'wallet' &&
      typeof a.address === 'string' &&
      (a.chainType === 'stellar' || a.address.startsWith('G')),
  );
  if (!stellarAccount?.address) {
    throw new Error(
      'Usuário Privy sem wallet Stellar vinculada. Configurar Stellar em dashboard.privy.io.',
    );
  }

  const email = linkedAccounts.find((a) => a.type === 'email')?.email;

  return {
    userId: claims.userId,
    email,
    stellarAddress: stellarAccount.address,
  };
}

/**
 * Idempotente: retorna o endereço Stellar do user Privy, criando se ainda
 * não existir. Evita o bug "uma wallet por login" que acumula até bater o
 * limite de 100 por user (acontece quando client-side cria sem dedup).
 *
 * Padrão correto:
 *   1. Server consulta `privy.getUserById(userId)` (verdade de Privy).
 *   2. Procura linkedAccount com address `G...` (chainType=stellar).
 *   3. Se existir → retorna.
 *   4. Se não → `privy.wallets().create({chain_type:'stellar', owner:{user_id}})`.
 *
 * Race: 2 chamadas simultâneas pré-criação criam 2 wallets. Pra produção,
 * adicionar dedup via Prisma `Investidor.privyId` unique + transaction.
 * Pro POC, aceita-se o risco — usuário único na demo.
 */
export async function ensureStellarWallet(userId: string): Promise<string> {
  const privy = getPrivyClient();

  const existing = await getStellarAddressForUser(userId);
  if (existing) return existing;

  // Não tem wallet — cria server-side, vinculada ao user.
  const wallet = await privy.walletApi.createWallet({
    chainType: 'stellar',
    owner: { userId },
  });
  return wallet.address;
}

/** Retorna endereço Stellar do user ou null se não tiver wallet. */
export async function getStellarAddressForUser(
  userId: string,
): Promise<string | null> {
  const privy = getPrivyClient();
  const user = await privy.getUserById(userId);
  const linkedAccounts = (user.linkedAccounts ?? []) as PrivyLinkedAccount[];
  const stellar = linkedAccounts.find(
    (a) =>
      a.type === 'wallet' &&
      typeof a.address === 'string' &&
      (a.chainType === 'stellar' || a.address.startsWith('G')),
  );
  return stellar?.address ?? null;
}

/**
 * Converte signature hex 0x... (formato Privy useSignRawHash) pra base64
 * que `stellar-sdk` `transaction.addSignature` espera.
 *
 * Privy retorna 130 chars: '0x' + 128 hex = 64 bytes Ed25519.
 */
export function privySignatureToBase64(signatureHex: string): string {
  const hex = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (hex.length !== 128) {
    throw new Error(
      `Signature inválida: esperado 128 hex chars (64 bytes Ed25519), recebido ${hex.length}.`,
    );
  }
  return Buffer.from(hex, 'hex').toString('base64');
}
