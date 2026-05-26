/**
 * Seed reusável pros specs E2E full-flow.
 *
 * Cada spec gera um Investidor isolado: keypair Stellar testnet novo
 * (Friendbot), customer Etherfuse + KYC programático + bank PIX
 * registrado (PLINA-MOD-006), trustlines TESOURO + PLINARF assinadas
 * localmente, row no DB com `privyId = did:privy:e2e-<pubkey>`.
 *
 * Pareado com `lib/wallet/privy.ts` stub mode (`PRIVY_VERIFY_STUB=true`)
 * + `lib/hooks/privy.tsx` client stub. Backend aceita Bearer
 * `e2e-stub-<pubkey>` e mapeia pra essa linha.
 *
 * Cleanup helper `cleanupE2eInvestidor(privyId)` deleta cascade
 * (Quote/OnRampOrder/OffRampOrder/EventoAudit/Investidor).
 */

import {
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { StatusInvestidor } from '@prisma/client';

import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import {
  createFundedAccount,
  horizon,
  buildAsset,
} from '@/lib/stellar/account';
import {
  networkPassphrase,
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
} from '@/lib/stellar/config';
import { getDynamicFee } from '@/lib/stellar/fee';

const DUMMY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

export interface E2eInvestidorSeed {
  pubkey: string;
  secret: string;
  email: string;
  privyId: string;
  investidorId: string;
  etherfuseCustomerId: string;
  etherfuseBankAccountId: string;
}

function etherfuseFromEnv(): EtherfuseClient {
  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) throw new Error('ETHERFUSE_API_KEY ausente');
  return new EtherfuseClient({
    apiKey,
    baseUrl:
      process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });
}

async function pollKycApproved(
  anchor: EtherfuseClient,
  customerId: string,
  publicKey: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await anchor.getKycStatus(customerId, publicKey);
    if (s === 'approved') return;
    if (s === 'rejected') throw new Error('KYC rejected em seed');
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('KYC polling timeout em seed');
}

async function changeTrust(kp: Keypair, asset: Asset): Promise<void> {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

/**
 * Cria ambiente isolado pra um spec E2E. Tudo programático — pareado com
 * stub do auth-guard que aceita `e2e-stub-<pubkey>`.
 */
export async function seedE2eInvestidor(): Promise<E2eInvestidorSeed> {
  // 1. Keypair Stellar testnet fundado.
  const kp = await createFundedAccount();
  const pubkey = kp.publicKey();
  const secret = kp.secret();
  const privyId = `did:privy:e2e-${pubkey}`;
  // Email determinístico — mesmo formato do stub server (lib/wallet/privy.ts).
  // Garante idempotência do onboardInvestidor que faz findFirst por email.
  const email = `e2e-${pubkey.slice(0, 8).toLowerCase()}@plina.test`;

  const anchor = etherfuseFromEnv();

  // 2. Customer + KYC + agreements (smoke step 4-8).
  const customer = await anchor.createCustomer({
    email,
    publicKey: pubkey,
    country: 'BR',
  });

  await anchor.submitKycIdentity(customer.id, {
    pubkey,
    identity: {
      id: pubkey,
      name: { givenName: 'E2E', familyName: 'Plina' },
      dateOfBirth: '1990-01-15',
      address: {
        street: 'Av. Faria Lima, 1000',
        city: 'São Paulo',
        region: 'SP',
        postalCode: '01310-100',
        country: 'BR',
      },
      idNumbers: [{ value: '52998224725', type: 'CPF' }],
    },
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey,
    documentType: 'document',
    images: [
      { label: 'id_front', image: DUMMY_PNG_BASE64 },
      { label: 'id_back', image: DUMMY_PNG_BASE64 },
    ],
  });
  await anchor.submitKycDocuments(customer.id, {
    pubkey,
    documentType: 'selfie',
    images: [{ label: 'selfie', image: DUMMY_PNG_BASE64 }],
  });

  const bankAccountStubId = customer.bankAccountId ?? crypto.randomUUID();
  const kycUrl = await anchor.getKycUrl(customer.id, pubkey, bankAccountStubId);
  try {
    await anchor.acceptElectronicSignature(kycUrl);
    await anchor.acceptTermsAndConditions(kycUrl);
  } catch {
    // sandbox aceita os primeiros 2 mesmo sem phone; customer-agreement
    // falha em business — KYC aprova mesmo assim.
  }

  await pollKycApproved(anchor, customer.id, pubkey);

  // 3. Register PIX bank (PLINA-MOD-006).
  const bankResp = await anchor.registerPixBankAccount(kycUrl, {
    pixKey: '52998224725',
    pixKeyType: 'cpf',
    firstName: 'E2E',
    lastName: 'Plina',
    cpf: '52998224725',
  });
  const etherfuseBankAccountId =
    (bankResp as unknown as { accountId?: string; bankAccountId?: string })
      .accountId ?? bankResp.bankAccountId;
  if (!etherfuseBankAccountId) {
    throw new Error('seed: register PIX retornou sem accountId');
  }

  // 4. Trustlines TESOURO + PLINARF (assina local — não usa Privy).
  const tesouro = await resolveTesouroAsset(pubkey);
  const tesouroAsset = new Asset(tesouro.code, tesouro.issuer);
  await changeTrust(kp, tesouroAsset);

  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  if (!issuerPubkey) {
    throw new Error('STELLAR_ISSUER_PUBLIC ausente (seed precisa pra PLINARF trustline)');
  }
  const plinarfAsset = buildAsset(issuerPubkey, assetCode);
  await changeTrust(kp, plinarfAsset);

  // 5. Investidor no DB.
  const investidor = await db.investidor.create({
    data: {
      nome: 'E2E Plina',
      email,
      publicKey: pubkey,
      privyId,
      etherfuseCustomerId: customer.id,
      etherfuseBankAccountId,
      cpfNormalizado: '52998224725',
      isSyntheticCpf: true,
      kycAprovado: true,
      status: StatusInvestidor.AUTORIZADO,
    },
  });

  return {
    pubkey,
    secret,
    email,
    privyId,
    investidorId: investidor.id,
    etherfuseCustomerId: customer.id,
    etherfuseBankAccountId,
  };
}

/**
 * Apaga Investidor seedado + cascade (Quote, OnRampOrder, OffRampOrder,
 * EventoAudit). Roda no teardown do spec.
 */
export async function cleanupE2eInvestidor(privyId: string): Promise<void> {
  const inv = await db.investidor.findUnique({ where: { privyId } });
  if (!inv) return;
  // Pega todos os quoteIds primeiro pra apagar OnRamp/OffRamp orders que
  // referenciam via quoteId (não via investidorId).
  const quotes = await db.quote.findMany({
    where: { investidorId: inv.id },
    select: { id: true },
  });
  const quoteIds = quotes.map((q) => q.id);

  await db.$transaction(async (tx) => {
    await tx.eventoAudit.deleteMany({ where: { investidorId: inv.id } });
    if (quoteIds.length > 0) {
      await tx.offRampOrder.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await tx.onRampOrder.deleteMany({ where: { quoteId: { in: quoteIds } } });
    }
    await tx.offRampOrder.deleteMany({ where: { investidorId: inv.id } });
    await tx.onRampOrder.deleteMany({ where: { investidorId: inv.id } });
    await tx.quote.deleteMany({ where: { investidorId: inv.id } });
    await tx.investidor.delete({ where: { id: inv.id } });
  });
}
