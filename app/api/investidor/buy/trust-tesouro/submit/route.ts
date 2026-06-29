/**
 * POST /api/investidor/buy/trust-tesouro/submit
 *
 * Submete trustline TESOURO assinada pelo investor (Privy raw hash).
 * TESOURO da Etherfuse NÃO tem AUTH_REQUIRED — não precisa do issuer
 * autorizar (diferente de PLINARF). Trustline é efetiva imediatamente.
 *
 * Body: { xdr, investorPubkey, signatureHex, investidorId? }
 * Returns: { trustlineTxHash }
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import {
  stellarPubkey,
  stellarSignatureHex,
  stellarXdr,
} from '@/lib/http/zod-stellar';
import { logStellarError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    xdr: stellarXdr(),
    investorPubkey: stellarPubkey(),
    signatureHex: stellarSignatureHex(),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const { xdr, investorPubkey, signatureHex } = Schema.parse(await req.json());

  if (investorPubkey !== user.publicKey) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'investorPubkey não corresponde ao investidor autenticado',
    );
  }

  // F-11: idempotente. Trustline TESOURO já persistida → retorna existente.
  const existing = await db.investidor.findUnique({
    where: { id: user.investidorId },
    select: { tesouroTrustlineTxHash: true },
  });
  if (existing?.tesouroTrustlineTxHash) {
    return ok(
      { trustlineTxHash: existing.tesouroTrustlineTxHash, idempotent: true },
      { requestId },
    );
  }

  let res;
  try {
    res = await submitWithPrivySignature({
      xdr,
      investorPubkey,
      investorSignatureHex: signatureHex,
    });
  } catch (err) {
    // Log redigido server-side (F-20); cliente recebe INTERNAL genérico.
    logStellarError('[trust-tesouro/submit]', err);
    throw err;
  }

  await db.$transaction(async (tx) => {
    await tx.investidor.update({
      where: { id: user.investidorId },
      data: { tesouroTrustlineTxHash: res.hash },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'TESOURO_TRUSTLINE_AUTORIZADA',
        operador: 'investidor-self-service',
        investidorId: user.investidorId,
        privyId: user.privyId,
        stellarTxHash: res.hash,
        payloadJson: {
          targetPubkey: investorPubkey,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return ok({ trustlineTxHash: res.hash }, { requestId });
});
