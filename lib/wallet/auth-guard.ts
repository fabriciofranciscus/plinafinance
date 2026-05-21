/**
 * Auth guard pras rotas /api/investidor/**.
 *
 * Modelo: cliente manda `Authorization: Bearer <privy-access-token>`,
 * o guard valida via `privy.verifyAuthToken` e resolve o Investidor pelo
 * `privyId` (chave estável da sessão, vide schema). Retorna 401 sem token /
 * token inválido, 403 se o usuário Privy ainda não foi onboardado.
 *
 * Uso:
 *   export const POST = withAuth(async (req, { user }) => { ... });
 *
 * Defense in depth: rotas continuam validando que `quoteId`/`orderId` do
 * body pertencem a `user.investidorId`. Auth não substitui — soma.
 *
 * Audit log: rotas devem gravar `privyId: user.privyId` em EventoAudit
 * (rastreabilidade individual exigida pela CVM 175).
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPrivyClient } from '@/lib/wallet/privy';

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthedInvestidor {
  privyId: string;
  investidorId: string;
  publicKey: string;
  email: string;
  etherfuseCustomerId: string | null;
}

/**
 * Extrai o token Bearer da request, valida via Privy e devolve o Investidor
 * vinculado. Lança AuthError com status apropriado em qualquer falha.
 */
export async function requireInvestidor(
  req: Request,
): Promise<AuthedInvestidor> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new AuthError('token Privy ausente', 401);
  }

  let claims;
  try {
    claims = await getPrivyClient().verifyAuthToken(token);
  } catch {
    throw new AuthError('token Privy inválido', 401);
  }

  const investidor = await db.investidor.findUnique({
    where: { privyId: claims.userId },
    select: {
      id: true,
      publicKey: true,
      email: true,
      etherfuseCustomerId: true,
    },
  });
  if (!investidor) {
    throw new AuthError('investidor não onboardado', 403);
  }

  return {
    privyId: claims.userId,
    investidorId: investidor.id,
    publicKey: investidor.publicKey,
    email: investidor.email,
    etherfuseCustomerId: investidor.etherfuseCustomerId,
  };
}

/**
 * Wrapper pras rotas. Converte AuthError em NextResponse; outros erros
 * sobem pra o try/catch genérico da rota.
 */
export function withAuth(
  handler: (
    req: Request,
    ctx: { user: AuthedInvestidor },
  ) => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    let user: AuthedInvestidor;
    try {
      user = await requireInvestidor(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      throw err;
    }
    return handler(req, { user });
  };
}
