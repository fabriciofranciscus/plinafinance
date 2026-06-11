/**
 * Transporter SMTP compartilhado (nodemailer). Mesmo backend do lead
 * institucional (`app/actions/submit-lead.ts`), mas aqui retorna `null` quando
 * o SMTP não está configurado — emails transacionais são best-effort e viram
 * no-op em dev/test, sem quebrar o funil nem a suíte.
 */

import nodemailer from 'nodemailer';

// Cache por credencial (host:port:user) — suporta múltiplas caixas (contato@
// pro lead, help@ pros incidentes) sem recriar transporters a cada chamada.
const cache = new Map<string, nodemailer.Transporter>();

function build(
  user: string | undefined,
  pass: string | undefined,
): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host || !user || !pass) return null;

  const key = `${host}:${port}:${user}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const tx = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  cache.set(key, tx);
  return tx;
}

/** Caixa padrão (contato@) — lead institucional / contato. */
export function getTransporter(): nodemailer.Transporter | null {
  return build(process.env.SMTP_USER, process.env.SMTP_PASS);
}

/**
 * Caixa de incidentes (help@). Usa INCIDENT_SMTP_USER/PASS; se não
 * configuradas, cai na caixa padrão (mantém o comportamento anterior).
 */
export function getIncidentTransporter(): nodemailer.Transporter | null {
  return build(
    process.env.INCIDENT_SMTP_USER ?? process.env.SMTP_USER,
    process.env.INCIDENT_SMTP_PASS ?? process.env.SMTP_PASS,
  );
}

/** Endereço autenticado da caixa de incidentes (pro campo `from`). */
export function incidentFromAddress(): string | undefined {
  return process.env.INCIDENT_SMTP_USER ?? process.env.SMTP_USER;
}
