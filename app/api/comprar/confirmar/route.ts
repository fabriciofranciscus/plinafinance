/**
 * POST /api/comprar/confirmar
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { reservaId }
 *
 * Passo 5 do wizard /comprar: confirmação da transferência. Gate: ownership +
 * KYC aprovado + cessão ASSINADA + reserva ATIVA não-expirada.
 *
 * Com a flag BUYER_SELF_REALIZACAO ligada (testnet/MVP) o comprador dispara
 * `executarCaminhoA` direto (Cota→REALIZADA, spread, on-chain) → recibo
 * imediato. Desligada (produção): retorna PENDENTE_CONFIRMACAO — um operador
 * roda o close-out fora de banda.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ReservaStatus, StatusCota, CessaoStatus } from '@prisma/client';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';
import { executarCaminhoA } from '@/lib/services/realizacao';
import { getFlag } from '@/lib/env/flags';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const Schema = z.object({ reservaId: z.string().min(1).max(60) }).strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  if (!user.pessoaId || !user.kycAprovado) {
    return NextResponse.json(
      { error: 'KYC do comprador é pré-requisito da confirmação.' },
      { status: 403 },
    );
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { reservaId } = parsed.data;

  const reserva = await db.reserva.findUnique({
    where: { id: reservaId },
    include: {
      cota: true,
      cessaoComprador: true,
      leadComprador: { select: { pessoaId: true } },
    },
  });
  if (!reserva || reserva.leadComprador.pessoaId !== user.pessoaId) {
    return NextResponse.json(
      { error: 'Reserva não encontrada para este comprador.' },
      { status: 404 },
    );
  }
  if (reserva.cessaoComprador?.status !== CessaoStatus.ASSINADA) {
    return NextResponse.json(
      { error: 'Cessão precisa estar assinada antes da confirmação.' },
      { status: 409 },
    );
  }
  if (reserva.status !== ReservaStatus.ATIVA) {
    return NextResponse.json(
      { error: `Reserva em estado ${reserva.status} — não confirmável.` },
      { status: 409 },
    );
  }
  if (reserva.expiraEm.getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'Reserva expirada.' },
      { status: 409 },
    );
  }

  // valorRealizado = valor de revenda (valorCarta × (1 - desagioRevenda)).
  if (!reserva.cota.desagioRevenda) {
    return NextResponse.json(
      { error: 'Cota sem deságio de revenda definido.' },
      { status: 409 },
    );
  }
  const valorRevenda = new Prisma.Decimal(reserva.cota.valorCarta)
    .mul(new Prisma.Decimal(1).minus(new Prisma.Decimal(reserva.cota.desagioRevenda)))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);

  const selfRealizacao = await getFlag('BUYER_SELF_REALIZACAO');
  if (!selfRealizacao) {
    return NextResponse.json({
      status: 'PENDENTE_CONFIRMACAO',
      valorRealizado: valorRevenda.toFixed(2),
    });
  }

  if (reserva.cota.status !== StatusCota.RESERVADA) {
    return NextResponse.json(
      { error: `Cota em estado ${reserva.cota.status} — esperado RESERVADA.` },
      { status: 409 },
    );
  }

  try {
    const result = await executarCaminhoA({
      reservaId,
      valorRealizado: valorRevenda.toFixed(2),
      operador: 'self-service:comprador',
    });
    return NextResponse.json({
      status: 'REALIZADA',
      realizacaoId: result.realizacaoId,
      spread: result.spread,
      valorRealizado: valorRevenda.toFixed(2),
      txHash: result.txHash,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
