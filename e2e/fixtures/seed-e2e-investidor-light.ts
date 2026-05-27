/**
 * Seed leve pros specs E2E contractuais authed (`*-authed.spec.ts`).
 *
 * Diferente do `seed-e2e-investidor.ts` full-flow: NÃO funda conta Stellar,
 * NÃO cria customer Etherfuse, NÃO assina trustline. Só insere uma linha
 * `Investidor` no DB com `privyId = did:privy:e2e-<pubkey>` pra `withAuth`
 * resolver via `lib/wallet/privy.ts` stub mode (PRIVY_VERIFY_STUB=true).
 *
 * Use quando o spec quer testar comportamento de handler *autenticado* sem
 * precisar de wallet on-chain ou KYC Etherfuse real (ex.: validação de body
 * Zod, guards de ownership 403, lookup 404).
 *
 * Cleanup via `cleanupE2eInvestidor(privyId)` (compartilhado).
 */

import { Keypair } from '@stellar/stellar-sdk';
import { StatusInvestidor } from '@prisma/client';

import { db } from '@/lib/db';

export interface E2eInvestidorLightSeed {
  pubkey: string;
  privyId: string;
  email: string;
  bearer: string;
  investidorId: string;
  etherfuseCustomerId: string;
}

export async function seedE2eInvestidorLight(): Promise<E2eInvestidorLightSeed> {
  const kp = Keypair.random();
  const pubkey = kp.publicKey();
  const privyId = `did:privy:e2e-${pubkey}`;
  const slug = pubkey.slice(0, 8).toLowerCase();
  const email = `e2e-${slug}@plina.test`;
  const etherfuseCustomerId = `cust_light_${slug}`;

  const inv = await db.investidor.create({
    data: {
      nome: 'E2E Light',
      email,
      publicKey: pubkey,
      privyId,
      etherfuseCustomerId,
      cpfNormalizado: '52998224725',
      isSyntheticCpf: true,
      kycAprovado: true,
      status: StatusInvestidor.AUTORIZADO,
    },
    select: { id: true },
  });

  return {
    pubkey,
    privyId,
    email,
    bearer: `e2e-stub-${pubkey}`,
    investidorId: inv.id,
    etherfuseCustomerId,
  };
}
