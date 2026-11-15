/**
 * GET /api/conta/me
 *
 * Headers: Authorization: Bearer <privy-access-token>
 *
 * Fonte única do estado de conta/KYC pro client (wizard /vender + header).
 * 401 (token ausente/inválido) → client trata como não autenticado.
 */

import { NextResponse } from 'next/server';
import { requirePessoa } from '@/lib/wallet/pessoa-auth';
import { AuthError } from '@/lib/wallet/auth-guard';
import { nomeDoCedente } from '@/lib/vender/nome';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requirePessoa(req);
    return NextResponse.json({
      authenticated: true,
      pessoaId: user.pessoaId,
      // Pessoa.nome nasce com o e-mail quando o onboarding não traz nome: a tela recebe null (e não o e-mail) nesse caso, para
      // não pré-preencher o KYC nem exibir o e-mail como nome (pós-cota 15/11).
      nome: nomeDoCedente(user.nome),
      email: user.email,
      kycAprovado: user.kycAprovado,
      kycStatus: user.kycStatus,
      papeis: user.papeis,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ authenticated: false }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
