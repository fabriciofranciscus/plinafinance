/**
 * Template do e-mail de incidente — disparado pelo botão "Reportar incidente"
 * (`app/investir/_components/shell/error-block.tsx` → Server Action
 * `app/actions/submit-incident.ts`). Destino: help@plina.finance.
 *
 * HTML inline minimalista, sem web fonts (compat. Outlook/Gmail/Apple Mail),
 * no mesmo padrão de `lib/email/templates-cedente.ts` e
 * `app/actions/email-templates.ts`. Todo conteúdo dinâmico é escapado.
 */

export interface IncidentEmailData {
  nome: string;
  email: string;
  ticketId: string;
  technical: string;
  mensagem?: string | null;
  pathname?: string | null;
  userAgent?: string | null;
  recebido: string; // ISO timestamp
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderIncidentEmail(d: IncidentEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `[Incidente] ${d.ticketId}`;
  const mensagem = (d.mensagem ?? '').trim();
  const pathname = (d.pathname ?? '').trim() || '—';
  const userAgent = (d.userAgent ?? '').trim() || '—';

  const text = [
    `Incidente reportado via /investir`,
    ``,
    `Ticket:     ${d.ticketId}`,
    `Nome:       ${d.nome}`,
    `E-mail:     ${d.email}`,
    `Rota:       ${pathname}`,
    `User-agent: ${userAgent}`,
    `Recebido:   ${d.recebido}`,
    ``,
    `Mensagem técnica:`,
    d.technical,
    ``,
    `Observações do usuário:`,
    mensagem || '(nenhuma)',
  ].join('\n');

  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:4px 12px 4px 0;font-size:12px;color:#758180;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:4px 0;font-size:13px;color:#132728;">${esc(value)}</td>
    </tr>`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#FFFFFF;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#057A99;">Plina · Incidente</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#132728;">${esc(d.ticketId)}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      ${row('Nome', d.nome)}
      ${row('E-mail', d.email)}
      ${row('Rota', pathname)}
      ${row('User-agent', userAgent)}
      ${row('Recebido', d.recebido)}
    </table>
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#758180;">Mensagem técnica</p>
    <pre style="margin:0 0 16px;padding:12px;background:#F2F4F4;border:1px solid #D8DCDD;font-family:SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;color:#132728;white-space:pre-wrap;word-break:break-all;">${esc(d.technical)}</pre>
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#758180;">Observações do usuário</p>
    <p style="margin:0;padding:12px;background:#F2F4F4;border:1px solid #D8DCDD;font-size:13px;color:#132728;line-height:1.5;white-space:pre-wrap;">${mensagem ? esc(mensagem) : '<span style="color:#919999;">(nenhuma)</span>'}</p>
  </div>`;

  return { subject, text, html };
}
