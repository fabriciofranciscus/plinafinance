/**
 * Envio best-effort de email transacional ao cedente (PRD §M1 F-M1-7).
 *
 * Nunca lança: falha de SMTP (ou SMTP ausente) só loga — o funil de originação
 * não pode quebrar por causa de email.
 */

import { getTransporter } from './transporter';
import {
  renderCedenteEmail,
  type CedenteEmailData,
  type CedenteEmailKind,
} from './templates-cedente';

export async function notifyCedente(
  to: string | null | undefined,
  kind: CedenteEmailKind,
  data: CedenteEmailData,
): Promise<void> {
  if (!to) return;
  const tx = getTransporter();
  if (!tx) return; // SMTP não configurado — no-op (dev/test).

  try {
    const { subject, text, html } = renderCedenteEmail(kind, data);
    await tx.sendMail({
      from: `"Plina Finance" <${process.env.SMTP_USER}>`,
      to,
      replyTo: process.env.SMTP_USER,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error(`[notifyCedente] falha no envio (${kind})`, err);
  }
}
