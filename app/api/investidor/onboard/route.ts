/**
 * POST /api/investidor/onboard
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { nome?: string }
 *
 * Cria/recupera Investidor: Privy wallet + Etherfuse customer + KYC
 * programático + DB record. Idempotente.
 */

import { z } from 'zod';
import { onboardInvestidor, investidorTrustlinesReady } from '@/lib/services/investidor';
import { getPrivyClient, extractPrivyEmail, type PrivyLinkedAccount } from '@/lib/wallet/privy';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';
import { isIntlInvestorFlowEnabled } from '@/lib/env/feature-gates';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// C-06: shape estrito do body (Zod). Onboard é POST autenticado mas
// caro (Etherfuse customer + KYC + DB writes), por isso rate-limit
// sensitiveAuthLimiter por IP.
const BodySchema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    cpf: z.string().max(40).optional(),
    // M4: jurisdição ISO 3166-1 alpha-2. Gateada por INTL_INVESTOR_FLOW.
    jurisdicao: z.string().length(2).optional(),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    throw new ApiError('RATE_LIMITED', 429, 'too many requests');
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new ApiError('UNAUTHORIZED', 401, 'token Privy ausente');
  }
  const privy = getPrivyClient();
  let claims;
  try {
    claims = await privy.verifyAuthToken(token);
  } catch {
    throw new ApiError('UNAUTHORIZED', 401, 'token Privy inválido');
  }

  // Zod rejeitado → ZodError → VALIDATION_FAILED 400 (withApi).
  const body = BodySchema.parse(await req.json().catch(() => ({})));

  // F-M0-6 / M4: onboarding de jurisdição não-BR só com INTL_INVESTOR_FLOW on.
  if (
    body.jurisdicao &&
    body.jurisdicao.toUpperCase() !== 'BR' &&
    !(await isIntlInvestorFlowEnabled())
  ) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'trilha internacional ainda não habilitada',
    );
  }

  // Email vem do Privy user (linkedAccounts) — cobre email + OAuth.
  const user = await privy.getUserById(claims.userId);
  const linked = (user.linkedAccounts ?? []) as PrivyLinkedAccount[];
  const email =
    extractPrivyEmail(linked) ??
    `${claims.userId.replace(/[^a-z0-9]/g, '')}@privy.plina.local`;

  // `cpf obrigatório` é lançado como ApiError('VALIDATION_FAILED',400) no
  // service (lib/services/pessoa.ts) — chega ao cliente com mensagem e status.
  const result = await onboardInvestidor({
    privyId: claims.userId,
    email,
    nome: body.nome,
    cpf: body.cpf,
  });

  // Detecta trustlines on-chain pra não re-pedir assinatura a cada reload.
  const trustlinesReady = await investidorTrustlinesReady(result.publicKey);

  return ok({ ...result, trustlinesReady }, { requestId });
});
