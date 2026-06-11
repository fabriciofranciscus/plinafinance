/**
 * GET /api/comprar/cotas
 *
 * Headers: Authorization: Bearer <privy-access-token>
 *
 * Passo 1 do wizard /comprar: cotas DISPONIVEL com deságio de revenda. Auth-
 * gated (só comprador logado). Filtros são client-side. Administradora NÃO
 * exposta (whitepaper §6.7).
 */

import { NextResponse } from 'next/server';
import { requirePessoa } from '@/lib/wallet/pessoa-auth';
import { AuthError } from '@/lib/wallet/auth-guard';
import { listarCotasParaCompra } from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requirePessoa(req);
    const cotas = await listarCotasParaCompra();
    return NextResponse.json({
      cotas: cotas.map((c) => ({
        id: c.id,
        tipoBem: c.tipoBem,
        valorCarta: Number(c.valorCarta),
        desagioRevenda: c.desagioRevenda ? Number(c.desagioRevenda) : null,
        localizacaoAprox: c.localizacaoAprox,
        prazoRestanteMeses: c.prazoRestanteMeses,
        statusEstoque: c.statusEstoque,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
