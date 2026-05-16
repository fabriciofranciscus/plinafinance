import { Asset, Horizon, Keypair } from '@stellar/stellar-sdk';
import { assetCode, friendbotUrl, horizonUrl } from './config';

export const horizon = new Horizon.Server(horizonUrl);

/**
 * Cria um keypair novo e funda via friendbot (testnet only).
 * Em produção, accounts são criadas via `createAccount` operation a partir de
 * uma conta já existente.
 */
export async function createFundedAccount(): Promise<Keypair> {
  const kp = Keypair.random();
  const res = await fetch(`${friendbotUrl}?addr=${kp.publicKey()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Friendbot falhou para ${kp.publicKey()}: ${res.status} ${body}`,
    );
  }
  return kp;
}

export async function loadAccount(pubkey: string) {
  return horizon.loadAccount(pubkey);
}

export async function accountExists(pubkey: string): Promise<boolean> {
  try {
    await horizon.loadAccount(pubkey);
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 404
    ) {
      return false;
    }
    throw err;
  }
}

export function buildAsset(issuerPubkey: string, code: string = assetCode): Asset {
  return new Asset(code, issuerPubkey);
}

/**
 * Funda uma conta Stellar testnet via friendbot. No-op silencioso se já
 * existir. Útil pra wallets recém-criadas pelo Privy (que não fundam
 * automaticamente — só registram o keypair no MPC custody).
 *
 * **Testnet only**. Mainnet exige `createAccount` operation a partir de
 * uma conta com saldo.
 */
export async function fundAccountIfNeeded(pubkey: string): Promise<{
  funded: boolean;
}> {
  if (await accountExists(pubkey)) return { funded: false };
  const res = await fetch(`${friendbotUrl}?addr=${pubkey}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Friendbot falhou para ${pubkey}: ${res.status} ${body}`);
  }
  return { funded: true };
}
