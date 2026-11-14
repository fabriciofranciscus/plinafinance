/**
 * POST /api/investidor/liquidar/build  (E2-6; contrato contratos/2026-11-11-e2-4-resgate-api.md)
 *
 * Cota o resgate com queima ao NAV do ledger e devolve o envelope de 2 pernas (investidor → issuer queima PLINARF;
 * distributor → investidor paga TESOURO) SEM assinatura da Plina. O investidor é a sessão (sem `pubkey` no body).
 *
 * Body: { amountPlinarf }
 * Resposta: { quoteId, xdr, hashHex, amountPlinarf, brlEquivalente, navPorTokenNaCotacao, expiresAt }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { internalErrorResponse } from '@/lib/api/internal-error';
import { navUnavailableResponse } from '@/lib/api/nav-unavailable';
import { obterPrecoLiquidoTesouroBrl } from '@/lib/anchors/etherfuse/preco-tesouro';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import { cotarResgate } from '@/lib/services/resgate';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    amountPlinarf: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,7})?$/, 'amountPlinarf deve ser decimal com até 7 casas')
      .refine((v) => Number(v) > 0, 'amountPlinarf deve ser > 0'),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  try {
    if (!user.etherfuseCustomerId) {
      throw new ApiError('CONFLICT', 409, 'Conclua o cadastro antes de resgatar.');
    }
    const tesouro = await resolveTesouroAsset(user.publicKey);
    const precoTesouroBrl = await obterPrecoLiquidoTesouroBrl({
      customerId: user.etherfuseCustomerId,
      stellarAddress: user.publicKey,
    });
    const result = await cotarResgate({
      investidorId: user.investidorId,
      investorPubkey: user.publicKey,
      amountPlinarf: parsed.data.amountPlinarf,
      precoTesouroBrl,
      bridgeAsset: { code: tesouro.code, issuer: tesouro.issuer },
    });
    return NextResponse.json(result);
  } catch (err) {
    const indisponivel = navUnavailableResponse(err, 'liquidar/build');
    if (indisponivel) return indisponivel;
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return internalErrorResponse(err, 'liquidar/build');
  }
});
