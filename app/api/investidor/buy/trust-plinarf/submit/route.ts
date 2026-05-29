/**
 * POST /api/investidor/buy/trust-plinarf/submit
 *
 * Submete trustline PLINARF assinada pelo investor + issuer autoriza
 * server-side. NÃO emite tokens — emissão é separada via /buy/swap após
 * onramp settled (Phase 2). Setup one-time idempotente.
 *
 * F-11 — idempotência on-chain:
 *  - `trustlineTxHash` persistido entre passos 1 e 2; retry após falha
 *    de authorize não re-submete trustline.
 *  - `EventoAudit(acao=TRUSTLINE_AUTORIZADA)` sinaliza passo 2 completo;
 *    retry após sucesso retorna hashes existentes (200).
 *
 * Body: { xdr, investorPubkey, signatureHex }
 * Returns: { trustlineTxHash, authorizeTxHash }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { issuerSigner } from '@/lib/stellar/signer';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
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

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { xdr, investorPubkey, signatureHex } = parsed.data;
  try {
    if (investorPubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'investorPubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }

    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    if (!issuerSecret) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_SECRET ausente' },
        { status: 500 },
      );
    }

    await assertElegivelParaTrustline({
      investidorId: user.investidorId,
      publicKey: investorPubkey,
    });

    // Checkpoint: ler estado persistido antes de submeter qualquer tx.
    const [investidor, existingAuth] = await Promise.all([
      db.investidor.findUnique({
        where: { id: user.investidorId },
        select: { trustlineTxHash: true },
      }),
      db.eventoAudit.findFirst({
        where: {
          investidorId: user.investidorId,
          acao: 'TRUSTLINE_AUTORIZADA',
        },
        select: { stellarTxHash: true, payloadJson: true },
        orderBy: { criadoEm: 'desc' },
      }),
    ]);

    // Estado 1: ambos passos já concluídos → idempotente.
    if (investidor?.trustlineTxHash && existingAuth?.stellarTxHash) {
      logStellarError(
        '[trust-plinarf/submit] idempotente (ambos passos)',
        new Error('retry após sucesso completo'),
      );
      return NextResponse.json({
        trustlineTxHash: investidor.trustlineTxHash,
        authorizeTxHash: existingAuth.stellarTxHash,
        idempotent: true,
      });
    }

    // Estado 2: trustline persistida mas authorize falhou → retomar só passo 2.
    let trustlineHash: string;
    if (investidor?.trustlineTxHash) {
      trustlineHash = investidor.trustlineTxHash;
      logStellarError(
        '[trust-plinarf/submit] retomando após falha de authorize',
        new Error(`reusando trustlineTxHash ${trustlineHash}`),
      );
    } else {
      // Estado 3: nada feito → submeter trustline e persistir antes de authorize.
      const trustlineRes = await submitWithPrivySignature({
        xdr,
        investorPubkey,
        investorSignatureHex: signatureHex,
      });
      trustlineHash = trustlineRes.hash;
      await db.investidor.update({
        where: { id: user.investidorId },
        data: { trustlineTxHash: trustlineHash },
      });
    }

    // Passo 2: authorize. Hash final só commitado depois do audit log.
    const authRes = await authorizeTrustline(issuerSigner(), investorPubkey);

    await db.eventoAudit.create({
      data: {
        acao: 'TRUSTLINE_AUTORIZADA',
        operador: 'investidor-self-service',
        investidorId: user.investidorId,
        privyId: user.privyId,
        stellarTxHash: authRes.hash,
        payloadJson: {
          trustlineTxHash: trustlineHash,
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      trustlineTxHash: trustlineHash,
      authorizeTxHash: authRes.hash,
    });
  } catch (err) {
    logStellarError('[trust-plinarf/submit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
