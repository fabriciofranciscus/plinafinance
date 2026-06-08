/**
 * Auth guard de Pessoa (conta unificada) — pras rotas de cedente / conta
 * (`/api/conta/**`, `/api/vender/lead`).
 *
 * Diferença pro `requireInvestidor` (auth-guard.ts): NÃO exige onboarding.
 * Valida o token Privy via `verifyPrivyTokenLite` (sem wallet) e resolve a
 * Pessoa por `privyId`. Se a Pessoa ainda não existe (primeiro acesso, antes
 * do KYC) retorna `pessoaId: null` — a rota de onboarding cria. Só dá 401 em
 * token ausente/inválido.
 *
 * Audit: rotas devem gravar `privyId: user.privyId` em EventoAudit (CVM 175).
 */

import { NextResponse } from 'next/server';
import { KycStatus, type Papel } from '@prisma/client';
import { db } from '@/lib/db';
import { verifyPrivyTokenLite } from '@/lib/wallet/privy';
import { AuthError } from '@/lib/wallet/auth-guard';

export interface AuthedPessoa {
  privyId: string;
  email: string;
  /** null enquanto a Pessoa não foi criada (pré-KYC). */
  pessoaId: string | null;
  nome: string | null;
  publicKey: string | null;
  papeis: Papel[];
  kycAprovado: boolean;
  kycStatus: KycStatus;
  etherfuseCustomerId: string | null;
}

/**
 * Extrai o Bearer, valida via Privy (sem exigir wallet) e resolve a Pessoa.
 * Lança AuthError(401) em token ausente/inválido. NÃO lança quando a Pessoa
 * não existe — devolve os claims com `pessoaId: null`.
 */
export async function requirePessoa(req: Request): Promise<AuthedPessoa> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new AuthError('token Privy ausente', 401);
  }

  let claims;
  try {
    claims = await verifyPrivyTokenLite(token);
  } catch {
    throw new AuthError('token Privy inválido', 401);
  }

  const pessoa = await db.pessoa.findUnique({
    where: { privyId: claims.userId },
    select: {
      id: true,
      nome: true,
      publicKey: true,
      papeis: true,
      kycAprovado: true,
      kycStatus: true,
      etherfuseCustomerId: true,
    },
  });

  return {
    privyId: claims.userId,
    email: claims.email,
    pessoaId: pessoa?.id ?? null,
    nome: pessoa?.nome ?? null,
    publicKey: pessoa?.publicKey ?? null,
    papeis: pessoa?.papeis ?? [],
    kycAprovado: pessoa?.kycAprovado ?? false,
    kycStatus: pessoa?.kycStatus ?? KycStatus.NAO_INICIADO,
    etherfuseCustomerId: pessoa?.etherfuseCustomerId ?? null,
  };
}

/**
 * Wrapper pras rotas. Converte AuthError em NextResponse; outros erros sobem
 * pro try/catch da rota.
 */
export function withPessoaAuth(
  handler: (req: Request, ctx: { user: AuthedPessoa }) => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    let user: AuthedPessoa;
    try {
      user = await requirePessoa(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
    return handler(req, { user });
  };
}
