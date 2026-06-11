/**
 * GET /api/comprar/cota/[id]/diligencia
 *
 * Headers: Authorization: Bearer <privy-access-token>
 *
 * Passo 2 do wizard /comprar: due diligence (jurídico + on-chain + trilha de
 * audit) da cota selecionada. Leitura pura — nenhuma escrita / tx nova.
 */

import { NextResponse } from 'next/server';
import { requirePessoa } from '@/lib/wallet/pessoa-auth';
import { AuthError } from '@/lib/wallet/auth-guard';
import { diligenciaDaCota } from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requirePessoa(req);
    const { id } = await ctx.params;
    const result = await diligenciaDaCota(id);
    if (!result) {
      return NextResponse.json({ error: 'Cota não encontrada' }, { status: 404 });
    }
    const { cota, eventos } = result;
    return NextResponse.json({
      cota: {
        id: cota.id,
        tipoBem: cota.tipoBem,
        valorCarta: Number(cota.valorCarta),
        desagioRevenda: cota.desagioRevenda ? Number(cota.desagioRevenda) : null,
        localizacaoAprox: cota.localizacaoAprox,
        prazoRestanteMeses: cota.prazoRestanteMeses,
        status: cota.status,
        statusEstoque: cota.statusEstoque,
        tokensEmitidos: Number(cota.tokensEmitidos),
        emissaoTxHash: cota.emissaoTxHash,
        hashValidacao: cota.hashValidacao,
        validacaoTxHash: cota.validacaoTxHash,
        hashCessao: cota.hashCessao,
      },
      eventos: eventos.map((e) => ({
        acao: e.acao,
        payloadHash: e.payloadHash,
        stellarTxHash: e.stellarTxHash,
        criadoEm: e.criadoEm.toISOString(),
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
