/**
 * POST /api/investidor/entidade
 *
 * Persiste o onboarding institucional (cartão 1 do mockup "Para Investidores")
 * nas colunas que já existem no `Investidor`: razaoSocial, cnpj, jurisdicao.
 * Os descritivos (entityType/estimatedTicket/currency) entram só no audit log
 * — não há coluna própria e querying não é necessário nesta fase.
 *
 * Endpoint dedicado (não estende /suitability) porque o CVM 30 exige respostas
 * que este cartão não coleta; acoplar a captura de CNPJ àquele questionário
 * seria incorreto.
 *
 * Trilha BR: exige cnpj válido (mod-11) + razaoSocial; jurisdicao fixada em 'BR'.
 * Trilha INTL: exige jurisdicao (ISO alpha-2) + razaoSocial; só passa com
 * INTL_INVESTOR_FLOW on (mesma guarda de /onboard).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { parseCnpj } from '@/lib/format/parse-cnpj';
import { isIntlInvestorFlowEnabled } from '@/lib/env/feature-gates';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    track: z.enum(['BR', 'INTL']),
    razaoSocial: z.string().min(1).max(200),
    cnpj: z.string().max(20).optional(),
    jurisdicao: z.string().length(2).optional(),
    entityType: z.enum(['FAMILY_OFFICE', 'ASSET_MANAGER', 'FUND', 'OTHER']),
    estimatedTicket: z.string().max(30).optional(),
    currency: z.enum(['BRL', 'USDC', 'EURC', 'USD', 'EUR']).optional(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const data = parsed.data;

  let cnpj: string | null = null;
  let jurisdicao: string;

  if (data.track === 'BR') {
    const normalized = parseCnpj(data.cnpj);
    if (!normalized) {
      return NextResponse.json(
        { error: 'CNPJ inválido' },
        { status: 400 },
      );
    }
    cnpj = normalized;
    jurisdicao = 'BR';
  } else {
    // Trilha internacional gated por M4 (mesma guarda de /onboard).
    if (!(await isIntlInvestorFlowEnabled())) {
      return NextResponse.json(
        { error: 'trilha internacional ainda não habilitada' },
        { status: 403 },
      );
    }
    if (!data.jurisdicao || data.jurisdicao.toUpperCase() === 'BR') {
      return NextResponse.json(
        { error: 'jurisdição (ISO alpha-2 não-BR) obrigatória na trilha internacional' },
        { status: 400 },
      );
    }
    jurisdicao = data.jurisdicao.toUpperCase();
  }

  await db.$transaction(async (tx) => {
    await tx.investidor.update({
      where: { id: user.investidorId },
      data: {
        razaoSocial: data.razaoSocial,
        cnpj,
        jurisdicao,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'ENTIDADE_PREENCHIDA',
        operador: 'investidor-self-service',
        investidorId: user.investidorId,
        privyId: user.privyId,
        payloadJson: {
          track: data.track,
          razaoSocial: data.razaoSocial,
          cnpj,
          jurisdicao,
          entityType: data.entityType,
          estimatedTicket: data.estimatedTicket ?? null,
          currency: data.currency ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return NextResponse.json({ persisted: true });
});
