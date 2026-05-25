/**
 * POST /api/admin/originacao
 *
 * Endpoint multiplexor pra ações de admin no funil vendedor. Auth via
 * cookie `plina_admin`. Cada action é um estágio do pipeline:
 *
 *   - gerar-oferta            → cria Oferta firme + envia
 *   - registrar-cessao        → DocuSign sandbox stub + hash on-chain
 *   - executar-pix-simulado   → marca Pix executado + audit
 *   - incorporar-cota         → wrapper de tokenizacao.incorporarCota
 *
 * Body: { action, ...payload }
 */

import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';
import {
  executarPixSimulado,
  gerarOferta,
  incorporarCotaDoFunil,
  registrarCessao,
} from '@/lib/services/originacao';
import { TipoBem } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { action?: string } & Record<string, unknown>;
    switch (body.action) {
      case 'gerar-oferta': {
        const result = await gerarOferta({
          leadVendedorId: String(body.leadVendedorId),
          tipoBem: String(body.tipoBem) as TipoBem,
          valorCarta: String(body.valorCarta),
          administradora: String(body.administradora),
          desagioAquisicao: String(body.desagioAquisicao),
          prazoRestanteMeses: body.prazoRestanteMeses
            ? Number(body.prazoRestanteMeses)
            : undefined,
          validadeHoras: body.validadeHoras
            ? Number(body.validadeHoras)
            : 48,
          operador: 'admin-panel',
        });
        return NextResponse.json({ ofertaId: result.id });
      }
      case 'registrar-cessao': {
        const result = await registrarCessao({
          ofertaId: String(body.ofertaId),
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'executar-pix-simulado': {
        const result = await executarPixSimulado({
          cessaoId: String(body.cessaoId),
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'incorporar-cota': {
        const result = await incorporarCotaDoFunil({
          cessaoId: String(body.cessaoId),
          localizacaoAprox: body.localizacaoAprox
            ? String(body.localizacaoAprox)
            : undefined,
          desagioRevenda: body.desagioRevenda
            ? String(body.desagioRevenda)
            : undefined,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          { error: `action desconhecida: ${body.action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
