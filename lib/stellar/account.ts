import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  STELLAR_FUNDER_PUBLIC,
  STELLAR_FUNDER_SECRET,
  STELLAR_FUNDER_STARTING_BALANCE,
  STELLAR_NETWORK,
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
  friendbotUrl,
  horizonUrl,
  networkPassphrase,
} from './config';
import { getDynamicFee } from './fee';

export const horizon = new Horizon.Server(horizonUrl);

/**
 * Cria um keypair novo e funda via friendbot. **Helper de teste/lab — testnet only.**
 * Em produção, accounts são criadas via `createAccount` operation a partir de
 * uma conta já existente (use `fundAccountIfNeeded` que cobre os dois casos).
 */
export async function createFundedAccount(): Promise<Keypair> {
  if (STELLAR_NETWORK === 'PUBLIC') {
    throw new Error(
      'createFundedAccount é testnet-only — em mainnet use fundAccountIfNeeded',
    );
  }
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
 * Funda uma conta Stellar. No-op silencioso se já existir. Útil pra wallets
 * recém-criadas pelo Privy (que não fundam automaticamente — só registram o
 * keypair no MPC custody).
 *
 * - TESTNET: friendbot.
 * - PUBLIC: `createAccount` op a partir de `STELLAR_FUNDER_*` (audit F-08).
 *   Sem funder configurado → erro explícito.
 */
export async function fundAccountIfNeeded(pubkey: string): Promise<{
  funded: boolean;
}> {
  if (await accountExists(pubkey)) return { funded: false };
  if (STELLAR_NETWORK === 'PUBLIC') {
    await fundViaCreateAccount(pubkey);
    return { funded: true };
  }
  const res = await fetch(`${friendbotUrl}?addr=${pubkey}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Friendbot falhou para ${pubkey}: ${res.status} ${body}`);
  }
  return { funded: true };
}

async function fundViaCreateAccount(destination: string): Promise<void> {
  if (!STELLAR_FUNDER_SECRET || !STELLAR_FUNDER_PUBLIC) {
    throw new Error(
      'STELLAR_FUNDER_SECRET/PUBLIC ausentes — funder mainnet não configurado',
    );
  }
  const funderKeypair = Keypair.fromSecret(STELLAR_FUNDER_SECRET);
  if (funderKeypair.publicKey() !== STELLAR_FUNDER_PUBLIC) {
    throw new Error('STELLAR_FUNDER_SECRET não corresponde ao FUNDER_PUBLIC');
  }
  const funderAccount = await horizon.loadAccount(STELLAR_FUNDER_PUBLIC);
  const tx = new TransactionBuilder(funderAccount, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.createAccount({
        destination,
        startingBalance: STELLAR_FUNDER_STARTING_BALANCE,
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  tx.sign(funderKeypair);
  await horizon.submitTransaction(tx);
}
