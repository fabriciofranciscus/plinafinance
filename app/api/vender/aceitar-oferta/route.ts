/**
 * POST /api/vender/aceitar-oferta
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { ofertaId }
 *
 * Vendedor aceita a oferta firme. Aceite juridicamente relevante (cessão de
 * direito creditório) com prova on-chain — por isso autenticado (withPessoaAuth),
 * gate de KYC e checagem de ownership: o `ofertaId` é um cuid não secreto, então
 * a posse é validada server-side (oferta.leadVendedor.pessoaId === user.pessoaId)
 * para impedir aceite forjado em nome de outra pessoa.
 *
 * Transição de estados: Oferta → ACEITA, LeadVendedor → OFERTA_ACEITA.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aceitarOferta } from '@/lib/services/originacao';
import { parseBody } from '@/lib/http/parse-body';
import { leadLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';

export const dynamic = 'force-dynamic';

const Schema = z.object({ ofertaId: z.string().min(1).max(60) }).strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await leadLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  // Gate: cedente precisa de KYC aprovado antes de aceitar a cessão.
  if (!user.pessoaId || !user.kycAprovado) {
    return NextResponse.json(
      { error: 'KYC pendente — conclua o cadastro antes de aceitar a oferta.' },
      { status: 403 },
    );
  }

  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { ofertaId } = parsed.data;

  try {
    const result = await aceitarOferta(ofertaId, user.pessoaId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (message.includes('não pertence')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    const isClientError =
      message.includes('não encontrada') ||
      message.includes('não aceitável') ||
      message.includes('expirada');
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 409 : 500 },
    );
  }
});
