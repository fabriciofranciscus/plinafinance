/**
 * POST /api/comprar/reserva
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { cotaId, sinalSimulado? }
 *
 * Passo 3 do wizard /comprar: aceita a proposta e cria a Reserva (72h). O
 * `leadCompradorId` é derivado server-side da sessão Privy — o client NÃO o
 * envia. Roda antes do KYC, então a Pessoa pode ainda não existir (pessoaId
 * null); o lead é resolvido por email e carimbado depois.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { parseBody } from '@/lib/http/parse-body';
import { leadLimiter, clientIp } from '@/lib/rate-limit/config';
import {
  criarReserva,
  resolverLeadCompradorPorPessoa,
} from '@/lib/services/realizacao';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    cotaId: z.string().min(1).max(60),
    sinalSimulado: z.string().max(20).optional(),
  })
  .strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await leadLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;

  try {
    const lead = await resolverLeadCompradorPorPessoa({
      pessoaId: user.pessoaId,
      email: user.email,
      nome: user.nome ?? user.email,
    });
    const result = await criarReserva({
      cotaId: body.cotaId,
      leadCompradorId: lead.id,
      sinalSimulado: body.sinalSimulado,
    });
    return NextResponse.json({
      reservaId: result.reservaId,
      expiraEm: result.expiraEm.toISOString(),
      txHash: result.txHash,
      payloadHash: result.payloadHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError =
      message.includes('não reservável') ||
      message.includes('deságio') ||
      message.includes('não encontrada');
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 409 : 500 },
    );
  }
});
