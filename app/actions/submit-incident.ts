'use server';

/**
 * Server Action do "Reportar incidente" (`error-block.tsx` → modal). Envia um
 * e-mail para help@plina.finance com nome/e-mail do usuário, as infos técnicas
 * do incidente (ticketId + mensagem técnica + rota + user-agent) e uma mensagem
 * livre opcional.
 *
 * Espelha `app/actions/submit-lead.ts`: honeypot, validação, rate-limit por IP e
 * envio best-effort via transporter SMTP compartilhado.
 */

import { headers } from 'next/headers';
import { z } from 'zod';
import { getTransporter } from '@/lib/email/transporter';
import { renderIncidentEmail } from '@/lib/email/templates-incident';
import { leadLimiter } from '@/lib/rate-limit/config';

export type IncidentState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

const Schema = z.object({
  nome: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  mensagem: z.string().trim().max(5000).optional(),
  ticketId: z.string().trim().min(1).max(40),
  technical: z.string().trim().max(5000),
  pathname: z.string().trim().max(500).optional(),
  userAgent: z.string().trim().max(500).optional(),
});

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() ?? 'unknown';
}

export async function submitIncident(
  _prev: IncidentState,
  formData: FormData,
): Promise<IncidentState> {
  // Honeypot — bots tendem a preencher campos invisíveis.
  if (typeof formData.get('website') === 'string' && formData.get('website')) {
    return { status: 'success' };
  }

  if (!(await leadLimiter.consume(await getClientIp()))) {
    return {
      status: 'error',
      message: 'Muitas tentativas. Aguarde um instante e tente de novo.',
    };
  }

  const parsed = Schema.safeParse({
    nome: formData.get('nome'),
    email: formData.get('email'),
    mensagem: formData.get('mensagem') ?? undefined,
    ticketId: formData.get('ticketId'),
    technical: formData.get('technical'),
    pathname: formData.get('pathname') ?? undefined,
    userAgent: formData.get('userAgent') ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Preencha nome e um e-mail válido para enviarmos o retorno.',
    };
  }
  const data = parsed.data;

  const tx = getTransporter();
  if (!tx) {
    return {
      status: 'error',
      message:
        'Serviço de envio indisponível no momento. Escreva direto para help@plina.finance.',
    };
  }

  const { subject, text, html } = renderIncidentEmail({
    ...data,
    recebido: new Date().toISOString(),
  });

  try {
    await tx.sendMail({
      from: `"Plina Incidentes" <${process.env.SMTP_USER}>`,
      to: process.env.INCIDENT_EMAIL_TO || 'help@plina.finance',
      replyTo: data.email,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error('[submitIncident] SMTP error', err);
    return {
      status: 'error',
      message:
        'Falha ao enviar. Tente novamente em instantes ou escreva para help@plina.finance.',
    };
  }

  return { status: 'success' };
}
