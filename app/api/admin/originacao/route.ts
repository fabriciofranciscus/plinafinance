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
import { z } from 'zod';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';
import { parseBody } from '@/lib/http/parse-body';
import {
  executarPixSimulado,
  gerarOferta,
  incorporarCotaDoFunil,
  registrarCessao,
} from '@/lib/services/originacao';
import { TipoBem } from '@prisma/client';

export const dynamic = 'force-dynamic';

const NumericString = z.string().regex(/^\d+(\.\d+)?$/, 'valor numérico inválido');

const Schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('gerar-oferta'),
      leadVendedorId: z.string().min(1).max(60),
      tipoBem: z.enum(['IMOVEL', 'VEICULO', 'EQUIPAMENTO', 'SERVICO']),
      valorCarta: NumericString,
      administradora: z.string().min(1).max(200),
      desagioAquisicao: NumericString,
      prazoRestanteMeses: z.number().int().positive().max(600).optional(),
      validadeHoras: z.number().int().positive().max(168).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('registrar-cessao'),
      ofertaId: z.string().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal('executar-pix-simulado'),
      cessaoId: z.string().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal('incorporar-cota'),
      cessaoId: z.string().min(1).max(60),
      localizacaoAprox: z.string().max(200).optional(),
      desagioRevenda: NumericString.optional(),
    })
    .strict(),
]);

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    switch (body.action) {
      case 'gerar-oferta': {
        const result = await gerarOferta({
          leadVendedorId: body.leadVendedorId,
          tipoBem: body.tipoBem as TipoBem,
          valorCarta: body.valorCarta,
          administradora: body.administradora,
          desagioAquisicao: body.desagioAquisicao,
          prazoRestanteMeses: body.prazoRestanteMeses,
          validadeHoras: body.validadeHoras ?? 48,
          operador: 'admin-panel',
        });
        return NextResponse.json({ ofertaId: result.id });
      }
      case 'registrar-cessao': {
        const result = await registrarCessao({
          ofertaId: body.ofertaId,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'executar-pix-simulado': {
        const result = await executarPixSimulado({
          cessaoId: body.cessaoId,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'incorporar-cota': {
        const result = await incorporarCotaDoFunil({
          cessaoId: body.cessaoId,
          localizacaoAprox: body.localizacaoAprox,
          desagioRevenda: body.desagioRevenda,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
