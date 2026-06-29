/**
 * POST /api/investidor/buy/offramp/submit
 *
 * Submete o burn XDR assinado via Privy. Real path = burnTransaction da
 * Etherfuse; mock path = Payment investor → distributor (TESOURO simbólico
 * queimado em Stellar real). Em ambos os casos, o hash retornado é uma tx
 * Stellar real e auditável em testnet.
 *
 * Idempotente: se `order.burnStellarTxHash` já existe, devolve direto.
 *
 * Body: { orderId, xdr, signatureHex }
 * Returns: { burnStellarTxHash, mock }
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
} from '@/lib/stellar/transactions';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { logStellarError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    orderId: z.string().min(1).max(60),
    xdr: z.string().min(1).max(8192),
    signatureHex: z.string().min(1).max(256),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { orderId, xdr, signatureHex } = Schema.parse(await req.json());

  const order = await db.offRampOrder.findUnique({ where: { id: orderId } });
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
  if (order.status !== 'signable_ready' && !order.burnStellarTxHash) {
    throw new ApiError(
      'CONFLICT',
      409,
      `order em status ${order.status} — chame /signing-tx primeiro`,
    );
  }

  const mock =
    (order.fiatInstructionsJson as Record<string, unknown> | null)?.__mock ===
    true;

  // Idempotência.
  if (order.burnStellarTxHash) {
    return ok(
      { burnStellarTxHash: order.burnStellarTxHash, mock },
      { requestId },
    );
  }

  // Fecha a janela de crash submit→commit: o hash é determinístico a partir
  // da XDR, então um retry pós-submit (burn já submetido, hash não persistido)
  // reconcilia pela chain em vez de re-submeter a mesma tx assinada.
  let res: { hash: string };
  try {
    const expectedTxHash = txHashFromXdr(xdr);
    const onchain = await fetchTransactionByHash(expectedTxHash);
    res = onchain?.successful
      ? { hash: onchain.hash }
      : await submitWithPrivySignature({
          xdr,
          investorPubkey: user.publicKey,
          investorSignatureHex: signatureHex,
        });
  } catch (err) {
    // Log redigido server-side (F-20); cliente recebe INTERNAL genérico.
    logStellarError('[offramp/submit]', err);
    throw err;
  }

  await db.$transaction(async (tx) => {
    await tx.offRampOrder.update({
      where: { id: order.id },
      data: {
        status: 'submitted',
        burnStellarTxHash: res.hash,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'OFFRAMP_BURN_ASSINADO',
        operador: mock ? 'sandbox-mock' : 'etherfuse-anchor',
        investidorId: order.investidorId,
        privyId: user.privyId,
        stellarTxHash: res.hash,
        payloadJson: {
          orderId: order.id,
          burnStellarTxHash: res.hash,
          mock,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return ok({ burnStellarTxHash: res.hash, mock }, { requestId });
});
