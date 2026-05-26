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
import { StrKey } from '@stellar/stellar-sdk';
import { db } from '@/lib/db';

let _privy: PrivyClient | null = null;

/**
 * E2E stub: retorna um PrivyClient fake que aceita Bearer
 * `e2e-stub-<G…>` (pubkey Stellar válido). Só ativa com
 * `PRIVY_VERIFY_STUB=true` (env de CI). Pareado com `lib/hooks/privy.ts`
 * client-side stub. Branch morto em produção via env constant fold.
 */
function getStubPrivyClient(): PrivyClient {
  return {
    verifyAuthToken: async (token: string) => {
      const m = token.match(/^e2e-stub-(G[A-Z2-7]{55})$/);
      if (!m) throw new Error('e2e stub: token inválido');
      return { userId: `did:privy:e2e-${m[1]}` };
    },
    getUserById: async (userId: string) => {
      const pubkey = userId.replace(/^did:privy:e2e-/, '');
      // Email determinístico por pubkey — seed precisa bater pra
      // `onboardInvestidor.findFirst({ where: { email } })` retornar
      // idempotente.
      const email = `e2e-${pubkey.slice(0, 8).toLowerCase()}@plina.test`;
      return {
        id: userId,
        linkedAccounts: [
          { type: 'wallet', chainType: 'stellar', address: pubkey },
          { type: 'email', email },
        ],
      };
    },
    walletApi: {
      createWallet: async () => {
        throw new Error('e2e stub: createWallet não suportado (use seed)');
      },
    },
    // Métodos não usados por handlers no flow E2E
  } as unknown as PrivyClient;
}

/** Singleton PrivyClient. Falha rápido se env faltar. */
export function getPrivyClient(): PrivyClient {
  if (_privy) return _privy;

  if (process.env.PRIVY_VERIFY_STUB === 'true') {
    _privy = getStubPrivyClient();
    return _privy;
  }

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
      (a.chainType === 'stellar' || StrKey.isValidEd25519PublicKey(a.address)),
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
 * limite de 100 por user (audit F-16).
 *
 * Race-safe: usa `WalletProvisioning` como lock por privyId em transação
 * Serializable. 2 chamadas concorrentes serializam → primeira chama
 * `privy.walletApi.createWallet`, segunda lê `publicKey` já persistido.
 */
export async function ensureStellarWallet(userId: string): Promise<string> {
  const privy = getPrivyClient();
  return await db.$transaction(
    async (tx) => {
      const lock = await tx.walletProvisioning.upsert({
        where: { privyId: userId },
        create: { privyId: userId },
        update: {},
      });
      if (lock.publicKey) return lock.publicKey;

      const existing = await getStellarAddressForUser(userId);
      if (existing) {
        await tx.walletProvisioning.update({
          where: { privyId: userId },
          data: { publicKey: existing },
        });
        return existing;
      }

      const wallet = await privy.walletApi.createWallet({
        chainType: 'stellar',
        owner: { userId },
      });
      await tx.walletProvisioning.update({
        where: { privyId: userId },
        data: { publicKey: wallet.address },
      });
      return wallet.address;
    },
    { isolationLevel: 'Serializable' },
  );
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
      (a.chainType === 'stellar' || StrKey.isValidEd25519PublicKey(a.address)),
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
