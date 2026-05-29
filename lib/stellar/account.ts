import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { KeypairSigner } from './signer';
import {
  FUNDER_BALANCE_FLOOR,
  FUNDER_DAILY_CAP,
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
import { db } from '../db';
import { logStellarError } from './log-error';

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

/**
 * Saldo de um asset emitido (não-nativo) numa wallet. Útil pra confirmar
 * mint TESOURO pós-onramp / saldo restante pós-burn.
 * Retorna "0" se trustline existe mas saldo é zero, ou se trustline ausente.
 */
export async function getAssetBalance(
  pubkey: string,
  code: string,
  issuer: string,
): Promise<string> {
  const acc = await horizon.loadAccount(pubkey);
  const balance = acc.balances.find((b) => {
    if (b.asset_type === 'native') return false;
    const issued = b as { asset_code?: string; asset_issuer?: string };
    return issued.asset_code === code && issued.asset_issuer === issuer;
  });
  return balance?.balance ?? '0';
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
 * N-09 / F-M0-4: alarme de saldo nativo (XLM). Não bloqueia — só loga quando
 * abaixo do piso, pra operador recarregar antes de drenar. Recebe os
 * `balances` de uma conta já carregada (evita round-trip extra ao Horizon).
 */
export function warnIfBalanceBelowFloor(
  balances: ReadonlyArray<{ asset_type: string; balance: string }>,
  floorXlm: string | number,
  label: string,
): void {
  const native = balances.find((b) => b.asset_type === 'native');
  if (!native) return;
  const balanceXlm = Number(native.balance);
  const floor = Number(floorXlm);
  if (balanceXlm < floor) {
    logStellarError(
      `[${label}] saldo baixo`,
      new Error(`${balanceXlm} XLM < ${floor} (floor)`),
    );
  }
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

  // N-09: cap diário global. Sem essa fence, vetor de drenagem é
  // múltiplos KYCs aprovados em sequência (cada um dispara 2 XLM do
  // funder). Conta WALLET_FUNDED nas últimas 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fundedToday = await db.eventoAudit.count({
    where: { acao: 'WALLET_FUNDED', criadoEm: { gte: since } },
  });
  if (fundedToday >= FUNDER_DAILY_CAP) {
    throw new Error(
      `funder daily cap atingido (${fundedToday}/${FUNDER_DAILY_CAP}) — operador deve investigar antes de bumpar`,
    );
  }

  const funderSigner = new KeypairSigner(STELLAR_FUNDER_SECRET);
  if (funderSigner.publicKey() !== STELLAR_FUNDER_PUBLIC) {
    throw new Error('STELLAR_FUNDER_SECRET não corresponde ao FUNDER_PUBLIC');
  }
  const funderAccount = await horizon.loadAccount(STELLAR_FUNDER_PUBLIC);

  // N-09: alarme de saldo. Não bloqueia (resiliência > pureza); operador
  // vê no log e bumpa o funder antes da próxima chamada.
  warnIfBalanceBelowFloor(funderAccount.balances, FUNDER_BALANCE_FLOOR, 'funder');

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
  funderSigner.sign(tx);
  const submitRes = await horizon.submitTransaction(tx);

  // N-09: registra o evento pra contagem do cap e auditoria CVM 175.
  await db.eventoAudit.create({
    data: {
      acao: 'WALLET_FUNDED',
      operador: 'funder-auto',
      stellarTxHash: submitRes.hash,
      payloadJson: {
        destination,
        startingBalance: STELLAR_FUNDER_STARTING_BALANCE,
      },
    },
  });
}
