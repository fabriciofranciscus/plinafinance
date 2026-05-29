/**
 * POST /api/investidor/suitability
 *
 * F-M3-5 — Submete o questionário CVM 30 e persiste em
 * `Investidor.suitabilityJson` + define `Investidor.tipo` derivado das
 * respostas. Idempotente (re-submissão atualiza). Pré-condição pro `/quote`
 * quando `M3_INSTITUTIONAL_GATING` está on.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import {
  type SuitabilityCVM30Persisted,
  tipoFromAnswers,
} from '@/lib/config/suitability';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    perfil: z.enum(['CONSERVADOR', 'MODERADO', 'ARROJADO']),
    experiencia: z.enum(['INICIANTE', 'INTERMEDIARIA', 'AVANCADA']),
    aumBrl: z.string().regex(/^\d+(\.\d{1,2})?$/, 'AUM inválido'),
    cienteRisco: z.literal(true),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const answers = parsed.data;

  const tipo = tipoFromAnswers(answers);
  const persisted: SuitabilityCVM30Persisted = {
    versao: 'CVM30-v1',
    preenchidoEm: new Date().toISOString(),
    ...answers,
  };

  await db.$transaction(async (tx) => {
    await tx.investidor.update({
      where: { id: user.investidorId },
      data: {
        suitabilityJson: persisted as unknown as Prisma.InputJsonValue,
        tipo,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'SUITABILITY_PREENCHIDA',
        operador: 'investidor-self-service',
        investidorId: user.investidorId,
        privyId: user.privyId,
        payloadJson: {
          tipo,
          perfil: answers.perfil,
          experiencia: answers.experiencia,
          aumBrl: answers.aumBrl,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return NextResponse.json({ tipo, persisted: true });
});
