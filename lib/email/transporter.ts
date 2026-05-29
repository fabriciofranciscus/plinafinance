/**
 * Transporter SMTP compartilhado (nodemailer). Mesmo backend do lead
 * institucional (`app/actions/submit-lead.ts`), mas aqui retorna `null` quando
 * o SMTP não está configurado — emails transacionais são best-effort e viram
 * no-op em dev/test, sem quebrar o funil nem a suíte.
 */

import nodemailer from 'nodemailer';

let cached: nodemailer.Transporter | null = null;

export function getTransporter(): nodemailer.Transporter | null {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}
