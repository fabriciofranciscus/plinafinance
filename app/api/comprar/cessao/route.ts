/**
 * POST /api/comprar/cessao
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { reservaId }
 *
 * Passo 4 (parte 2) do wizard /comprar: cessão digital. Gate: KYC aprovado +
 * reserva pertence ao comprador. Assinatura DocuSign/e-CPF no stub MVP; hash
 * do documento registrado on-chain de verdade. Idempotente por reservaId.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';
import { registrarCessaoComprador } from '@/lib/services/cessao-comprador';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const Schema = z.object({ reservaId: z.string().min(1).max(60) }).strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  if (!user.pessoaId || !user.kycAprovado) {
    return NextResponse.json(
      { error: 'KYC do comprador é pré-requisito da cessão.' },
      { status: 403 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { reservaId } = parsed.data;

  // Ownership: a reserva tem de ser do comprador logado.
  const reserva = await db.reserva.findUnique({
    where: { id: reservaId },
    select: { id: true, leadComprador: { select: { pessoaId: true } } },
  });
  if (!reserva || reserva.leadComprador.pessoaId !== user.pessoaId) {
    return NextResponse.json(
      { error: 'Reserva não encontrada para este comprador.' },
      { status: 404 },
    );
  }

  try {
    const result = await registrarCessaoComprador({
      reservaId,
      pessoaId: user.pessoaId,
    });
    return NextResponse.json({
      cessaoCompradorId: result.cessaoCompradorId,
      hashDocumento: result.hashDocumento,
      txHash: result.txHash,
      reused: result.reused,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError =
      message.includes('não assinável') || message.includes('não encontrada');
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 409 : 500 },
    );
  }
});
