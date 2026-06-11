/**
 * POST /api/comprar/kyc
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { nome?, cpf? }
 *
 * Passo 4 (parte 1) do wizard /comprar: KYC do comprador via Etherfuse
 * (sandbox auto-aprova). Reusa `ensureKycForPessoa` com papel COMPRADOR;
 * emite o próprio EventoAudit KYC_COMPRADOR (emitAudit:false no serviço pra
 * não gravar INVESTIDOR_ONBOARDED). Liga o LeadComprador à Pessoa recém-criada.
 *
 * Caro (Etherfuse + DB) → rate-limit sensitiveAuthLimiter por IP.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Papel, Prisma } from '@prisma/client';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { ensureKycForPessoa } from '@/lib/services/pessoa';
import { resolverLeadCompradorPorPessoa } from '@/lib/services/realizacao';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    cpf: z.string().max(40).optional(),
  })
  .strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;

  try {
    const result = await ensureKycForPessoa({
      privyId: user.privyId,
      email: user.email,
      nome: body.nome ?? user.nome ?? undefined,
      cpf: body.cpf,
      papel: Papel.COMPRADOR,
      emitAudit: false,
    });

    // Liga o lead (criado na reserva por email) à Pessoa agora existente.
    await resolverLeadCompradorPorPessoa({
      pessoaId: result.pessoaId,
      email: user.email,
      nome: body.nome ?? user.nome ?? user.email,
    });

    await db.eventoAudit.create({
      data: {
        acao: 'KYC_COMPRADOR',
        operador: 'self-service',
        privyId: user.privyId,
        payloadJson: {
          pessoaId: result.pessoaId,
          kycStatus: result.kycStatus,
          papel: Papel.COMPRADOR,
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      pessoaId: result.pessoaId,
      kycAprovado: result.kycAprovado,
      kycStatus: result.kycStatus,
      papeis: result.papeis,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError = message.startsWith('cpf obrigatório');
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 400 : 500 },
    );
  }
});
