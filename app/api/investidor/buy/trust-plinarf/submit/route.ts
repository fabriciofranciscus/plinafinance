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

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import { authorizeTrustline } from '@/lib/stellar/issuer';
import { issuerSigner } from '@/lib/stellar/signer';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
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
    /** F-M3-3. Code do asset Sênior (PLINARF) ou Subordinada (PLINARFB). */
    assetCode: z.string().min(1).max(12).optional(),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const {
    xdr,
    investorPubkey,
    signatureHex,
    assetCode: assetCodeInput,
  } = Schema.parse(await req.json());
  const defaultCode = process.env.ASSET_CODE ?? 'PLINARF';
  const subordinadaCode = process.env.ASSET_CODE_SUBORDINADA ?? 'PLINARFB';
  // F-M3-3: PLINARF = Sênior (legacy), PLINARFB = Subordinada (nova).
  const assetCode =
    assetCodeInput === subordinadaCode ? subordinadaCode : defaultCode;
  const isSubordinada = assetCode === subordinadaCode;
  try {
    if (investorPubkey !== user.publicKey) {
      throw new ApiError(
        'FORBIDDEN',
        403,
        'investorPubkey não corresponde ao investidor autenticado',
      );
    }

    const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
    if (!issuerSecret) {
      // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
      throw new Error('STELLAR_ISSUER_SECRET ausente');
    }

    await assertElegivelParaTrustline({
      investidorId: user.investidorId,
      publicKey: investorPubkey,
    });

    // F-M3-3: PLINARFB (Subordinada) usa idempotência via EventoAudit
    // (payloadJson.assetCode) — não toca `Investidor.trustlineTxHash`, que é
    // do legado PLINARF (Sênior). On-chain changeTrust/authorize são
    // idempotentes; aqui só evitamos re-submeter e re-logar.
    if (isSubordinada) {
      const existing = await db.eventoAudit.findFirst({
        where: {
          investidorId: user.investidorId,
          acao: 'TRUSTLINE_AUTORIZADA',
          payloadJson: {
            path: ['assetCode'],
            equals: assetCode,
          } as Prisma.JsonFilter,
        },
        select: { stellarTxHash: true, payloadJson: true },
        orderBy: { criadoEm: 'desc' },
      });
      if (existing?.stellarTxHash) {
        const payload = existing.payloadJson as {
          trustlineTxHash?: string;
        } | null;
        return ok(
          {
            trustlineTxHash: payload?.trustlineTxHash ?? null,
            authorizeTxHash: existing.stellarTxHash,
            assetCode,
            idempotent: true,
          },
          { requestId },
        );
      }
      const trustlineRes = await submitWithPrivySignature({
        xdr,
        investorPubkey,
        investorSignatureHex: signatureHex,
      });
      const authRes = await authorizeTrustline(
        issuerSigner(),
        investorPubkey,
        assetCode,
      );
      await db.eventoAudit.create({
        data: {
          acao: 'TRUSTLINE_AUTORIZADA',
          operador: 'investidor-self-service',
          investidorId: user.investidorId,
          privyId: user.privyId,
          stellarTxHash: authRes.hash,
          payloadJson: {
            trustlineTxHash: trustlineRes.hash,
            assetCode,
          } as Prisma.InputJsonValue,
        },
      });
      return ok(
        {
          trustlineTxHash: trustlineRes.hash,
          authorizeTxHash: authRes.hash,
          assetCode,
        },
        { requestId },
      );
    }

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
          // Exclui audits da Subordinada (assetCode=PLINARFB no payload).
          NOT: {
            payloadJson: {
              path: ['assetCode'],
              equals: subordinadaCode,
            } as Prisma.JsonFilter,
          },
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
      return ok(
        {
          trustlineTxHash: investidor.trustlineTxHash,
          authorizeTxHash: existingAuth.stellarTxHash,
          idempotent: true,
        },
        { requestId },
      );
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
          assetCode,
        } as Prisma.InputJsonValue,
      },
    });

    return ok(
      {
        trustlineTxHash: trustlineHash,
        authorizeTxHash: authRes.hash,
        assetCode,
      },
      { requestId },
    );
  } catch (err) {
    // Log redigido server-side (F-20) só pra erros internos/Stellar; ApiError
    // já é tratado (mensagem intencional) e iria virar ruído no log.
    if (!(err instanceof ApiError)) {
      logStellarError('[trust-plinarf/submit]', err);
    }
    throw err;
  }
});
