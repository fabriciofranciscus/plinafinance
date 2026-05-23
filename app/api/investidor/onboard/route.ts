/**
 * POST /api/investidor/onboard
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { nome?: string }
 *
 * Cria/recupera Investidor: Privy wallet + Etherfuse customer + KYC
 * programático + DB record. Idempotente.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { onboardInvestidor } from '@/lib/services/investidor';
import { getPrivyClient } from '@/lib/wallet/privy';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

// C-06: shape estrito do body (Zod). Onboard é POST autenticado mas
// caro (Etherfuse customer + KYC + DB writes), por isso rate-limit
// sensitiveAuthLimiter por IP.
const BodySchema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    cpf: z.string().max(40).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (!sensitiveAuthLimiter.consume(clientIp(req))) {
    return NextResponse.json(
      { error: 'too many requests' },
      { status: 429 },
    );
  }
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json(
        { error: 'token Privy ausente' },
        { status: 401 },
      );
    }
    const privy = getPrivyClient();
    const claims = await privy.verifyAuthToken(token);

    const raw = await req.json().catch(() => ({}));
    const bodyParsed = BodySchema.safeParse(raw);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: 'body inválido', issues: bodyParsed.error.issues },
        { status: 400 },
      );
    }
    const body = bodyParsed.data;

    // Email vem do Privy user (linkedAccounts).
    const user = await privy.getUserById(claims.userId);
    const linked = (user.linkedAccounts ?? []) as Array<{
      type: string;
      email?: string;
      address?: string;
    }>;
    const email =
      linked.find((a) => a.type === 'email')?.email ??
      `${claims.userId.replace(/[^a-z0-9]/g, '')}@privy.plina.local`;

    const result = await onboardInvestidor({
      privyId: claims.userId,
      email,
      nome: body.nome,
      cpf: body.cpf,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError = message.startsWith('cpf obrigatório');
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
}
