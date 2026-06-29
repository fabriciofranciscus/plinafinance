/**
 * POST /api/investidor/buy/offramp/signing-tx
 *
 * Devolve o XDR de burn pra investor assinar via Privy raw-hash.
 *
 *   - Real path: poll `anchor.getOffRampTransaction(orderId)` até
 *     `signableTransaction` (alias de `burnTransaction` upstream) ficar
 *     presente. Etherfuse prepara após ~5s.
 *   - Mock path (sandbox sem bank ativa, OffRampOrder marcado __mock):
 *     constrói um Payment Stellar real do investor → distributor Plina
 *     consumindo TESOURO da wallet. Burn simbólico, tx Stellar é real.
 *
 * Idempotente: se `order.burnXdr` já existe, retorna direto (reidrata
 * hashHex do XDR).
 *
 * Body: { orderId }
 * Returns: { xdr, hashHex, mock }
 */

import { z } from 'zod';
import { Transaction } from '@stellar/stellar-sdk';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { buildPaymentXdr } from '@/lib/stellar/transactions';
import { buildAsset } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';

export const dynamic = 'force-dynamic';

const Schema = z.object({ orderId: z.string().min(1).max(60) }).strict();

function hashHexFromXdr(xdr: string): string {
  const tx = new Transaction(xdr, networkPassphrase);
  return '0x' + tx.hash().toString('hex');
}

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { orderId } = Schema.parse(await req.json());

  const order = await db.offRampOrder.findUnique({
    where: { id: orderId },
    include: { quote: true },
  });
  if (!order) {
    throw new ApiError('NOT_FOUND', 404, 'order não encontrada');
  }
  if (order.investidorId !== user.investidorId) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'order não pertence ao investidor autenticado',
    );
  }

  const mock =
    (order.fiatInstructionsJson as Record<string, unknown> | null)?.__mock ===
    true;

  // Idempotência: burnXdr já persistido → reidrata e devolve.
  if (order.burnXdr) {
    return ok(
      { xdr: order.burnXdr, hashHex: hashHexFromXdr(order.burnXdr), mock },
      { requestId },
    );
  }

  let xdr: string;

  if (mock) {
    const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
    if (!distributorPubkey) {
      // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
      throw new Error(
        'STELLAR_DISTRIBUTOR_PUBLIC ausente — não dá pra construir burn mock',
      );
    }
    const tesouro = await resolveTesouroAsset(user.publicKey);
    const built = await buildPaymentXdr({
      investorPubkey: user.publicKey,
      destination: distributorPubkey,
      asset: buildAsset(tesouro.issuer, tesouro.code),
      amount: order.quote.fromAmount.toFixed(7),
      memo: `offramp:${order.id.slice(0, 22)}`,
    });
    xdr = built.xdr;
  } else {
    const apiKey = process.env.ETHERFUSE_API_KEY;
    if (!apiKey) {
      throw new Error('ETHERFUSE_API_KEY ausente');
    }
    const anchor = new EtherfuseClient({
      apiKey,
      baseUrl:
        process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
    });
    const ready = await anchor.pollOffRampForSignable(order.id, {
      intervalMs: 2_000,
      timeoutMs: 120_000,
    });
    if (!ready.signableTransaction) {
      // Erro operacional do anchor — safe surfaciar (não vaza secret).
      throw new ApiError(
        'ETHERFUSE_ERROR',
        502,
        'Etherfuse retornou order sem signableTransaction após poll',
      );
    }
    xdr = ready.signableTransaction;
  }

  const hashHex = hashHexFromXdr(xdr);

  await db.offRampOrder.update({
    where: { id: order.id },
    data: { burnXdr: xdr, status: 'signable_ready' },
  });

  return ok({ xdr, hashHex, mock }, { requestId });
});
