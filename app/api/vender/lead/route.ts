/**
 * POST /api/vender/lead
 *
 * Captura lead vendedor + prova on-chain do consentimento LGPD.
 *
 * Agora autenticado (withPessoaAuth): o cedente precisa estar logado (Privy)
 * e com KYC aprovado antes de enviar a cota. nome/email vêm da Pessoa
 * (anti-spoof); o lead é ligado à Pessoa via pessoaId.
 *
 * C-06: Zod strict + rate-limit anti-spam + BotID.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBotId } from 'botid/server';
import { capturarLead } from '@/lib/services/originacao';
import { parseBody } from '@/lib/http/parse-body';
import { leadLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    telefone: z.string().max(40).optional(),
    consentimentoLgpd: z.literal(true),
    origem: z.string().max(100).optional(),
    utmSource: z.string().max(100).optional(),
    utmMedium: z.string().max(100).optional(),
    utmCampaign: z.string().max(100).optional(),
  })
  .strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  // F-M0-5: bloqueia bots antes de qualquer trabalho. No-op em dev/local.
  // extraAllowedHosts cobre o alias www (2026-07-01 — ver BotIdClient em
  // app/layout.tsx, sem ele o servidor nunca recebia prova de humano).
  if (
    (
      await checkBotId({
        advancedOptions: { extraAllowedHosts: ['www.plina.finance'] },
      })
    ).isBot
  ) {
    return NextResponse.json({ error: 'acesso negado' }, { status: 403 });
  }
  if (!(await leadLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  // Gate: cedente precisa de KYC aprovado antes de enviar a cota.
  if (!user.pessoaId || !user.kycAprovado) {
    return NextResponse.json(
      { error: 'KYC pendente — conclua o cadastro antes de enviar a cota.' },
      { status: 403 },
    );
  }

  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;

  try {
    const result = await capturarLead({
      nome: user.nome ?? user.email,
      email: user.email,
      telefone: body.telefone,
      consentimentoLgpd: true,
      origem: body.origem ?? 'wizard-vender',
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      pessoaId: user.pessoaId,
      privyId: user.privyId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
