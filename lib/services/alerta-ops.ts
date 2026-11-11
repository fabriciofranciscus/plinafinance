/**
 * Alerta de operação por e-mail (mesmo canal do "Reportar incidente": caixa de incidentes, `lib/email`).
 * Melhor esforço: sem SMTP configurado vira no-op (devolve false) e nunca derruba a rota que o chamou.
 * O corpo leva só ids internos e contagens — sem XDR, chave nem PII.
 */

import { getIncidentTransporter, incidentFromAddress } from '../email/transporter';

export async function enviarAlertaOps(input: { assunto: string; linhas: string[] }): Promise<boolean> {
  const tx = getIncidentTransporter();
  if (!tx) return false;
  try {
    await tx.sendMail({
      from: `"Plina Operações" <${incidentFromAddress()}>`,
      to: process.env.INCIDENT_EMAIL_TO || 'help@plina.finance',
      subject: `[Plina · ALERTA] ${input.assunto}`,
      text: input.linhas.join('\n'),
    });
    return true;
  } catch (err) {
    console.error('[alerta-ops] envio falhou', (err as { name?: string })?.name ?? 'erro');
    return false;
  }
}
