// Templates de e-mail HTML para o fluxo de contato da landing (contato exploratório, sem oferta).
// Design alinhado ao DESIGN.md — paleta institucional, hairlines, mono para dados.
// Cores e fontes são pré-computadas (sem alpha, sem web fonts) para máxima
// compatibilidade com clientes de e-mail (Outlook, Gmail, Apple Mail, etc).

const COLORS = {
  petrol: '#132728',
  petrol70: '#5A6868',
  petrol55: '#758180',
  petrol40: '#919999',
  petrol15: '#D4D7D7',
  cyanDeep: '#057A99',
  cyan: '#0EA7C7',
  white: '#FFFFFF',
  grey: '#F2F4F4',
  pageGrey: '#E8EAEA',
  hairline: '#D8DCDD',
};

const SANS = `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
const MONO = `SFMono-Regular, Consolas, Menlo, "Liberation Mono", monospace`;

export type LeadData = {
  name: string;
  org: string;
  email: string;
  phone?: string;
  profile: string;       // já com label legível
  jurisdiction?: string;
  ticket?: string;       // já com label legível; opcional (sondagem sem oferta)
  currency?: string;
  classe?: string;
  timeline?: string;
  notes?: string;
  recebido: string;      // ISO timestamp
  /** E-mail já cadastrado: o cadastro original foi mantido (dados não alterados). */
  reenvio?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateBR(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate().toString().padStart(2, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = d.getUTCFullYear();
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} · ${hh}:${mm} UTC`;
}

// ----------------------------------------------------------------
// Auto-reply pro investidor
// ----------------------------------------------------------------

export function renderInvestorReply(d: LeadData) {
  const firstName = d.name.split(' ')[0];
  const subject = 'Plina · Recebemos seu contato';

  const text = `${firstName},

Recebemos seu contato pelo plina.finance. Nossa equipe responderá por e-mail assim que possível. Este e-mail confirma o recebimento; não é oferta nem solicitação de investimento, e não há oferta em andamento.

Próximos passos:

  01 · Resposta · Nossa equipe lê sua mensagem e responde por e-mail, assim que possível.
  02 · Conversa · Se fizer sentido, agendamos uma conversa com o time fundador.
  03 · Sem compromisso · Este é um contato exploratório. Não há oferta em andamento nem documentação de oferta a enviar.

Resumo do seu contato:

  Organização: ${d.org}
  Perfil: ${d.profile}${d.jurisdiction ? `\n  Jurisdição: ${d.jurisdiction}` : ''}

Em caso de dúvidas, basta responder este e-mail ou escrever para contato@plina.finance.

Você recebeu esta mensagem porque preencheu o formulário em plina.finance. Para pedir acesso, correção ou eliminação dos seus dados, responda este e-mail.

—
Plina Finance
Cotas contempladas de consórcio, com registro verificável em rede de testes
Contato exploratório · Sem oferta · Em desenvolvimento
`;

  const passos: Array<[string, string, string]> = [
    ['01', 'Resposta', 'Nossa equipe lê sua mensagem e responde por e-mail, assim que possível.'],
    ['02', 'Conversa', 'Se fizer sentido, agendamos uma conversa com o time fundador.'],
    [
      '03',
      'Sem compromisso',
      'Este é um contato exploratório. Não há oferta em andamento nem documentação de oferta a enviar.',
    ],
  ];

  const resumo: Array<[string, string]> = [
    ['Organização', d.org],
    ['Perfil', d.profile],
    ...(d.jurisdiction ? [['Jurisdição', d.jurisdiction] as [string, string]] : []),
  ];

  const passosHtml = passos
    .map(
      ([num, titulo, corpo]) => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;">
          <tr>
            <td valign="top" width="56" style="padding:0;font-family:${MONO};font-size:14px;font-weight:400;color:${COLORS.petrol40};letter-spacing:0.05em;line-height:1.4;">
              ${num}
            </td>
            <td valign="top" style="padding:0;">
              <p style="margin:0 0 6px 0;font-family:${SANS};font-size:15px;font-weight:600;color:${COLORS.petrol};line-height:1.35;letter-spacing:-0.01em;">
                ${esc(titulo)}
              </p>
              <p style="margin:0;font-family:${SANS};font-size:14px;font-weight:400;color:${COLORS.petrol70};line-height:1.55;">
                ${esc(corpo)}
              </p>
            </td>
          </tr>
        </table>`
    )
    .join('');

  const resumoRows = resumo
    .map(
      ([k, v], i) => `
        <tr>
          <td style="padding:14px 20px;font-family:${MONO};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${COLORS.petrol55};font-weight:700;${
            i === resumo.length - 1 ? '' : `border-bottom:1px solid ${COLORS.hairline};`
          }width:44%;">
            ${esc(k)}
          </td>
          <td style="padding:14px 20px;font-family:${MONO};font-size:13px;color:${COLORS.petrol};font-weight:500;${
            i === resumo.length - 1 ? '' : `border-bottom:1px solid ${COLORS.hairline};`
          }">
            ${esc(v)}
          </td>
        </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageGrey};font-family:${SANS};color:${COLORS.petrol};-webkit-font-smoothing:antialiased;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Recebemos seu contato. Nossa equipe responderá assim que possível.
  </span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.pageGrey};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${COLORS.white};border:1px solid ${COLORS.hairline};">

          <!-- Header bar -->
          <tr>
            <td style="background:${COLORS.petrol};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:22px 40px;font-family:${SANS};font-size:22px;font-weight:600;letter-spacing:-0.02em;color:${COLORS.white};">
                    Plina<span style="color:${COLORS.cyan};">.</span>
                  </td>
                  <td align="right" style="padding:22px 40px;font-family:${MONO};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#A0A8A8;">
                    Contato recebido
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Lead -->
          <tr>
            <td style="padding:48px 40px 0 40px;">
              <h1 style="margin:0 0 20px 0;font-family:${SANS};font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-0.025em;color:${COLORS.petrol};">
                ${esc(firstName)},
              </h1>
              <p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.6;color:${COLORS.petrol70};font-weight:400;">
                Recebemos seu contato pelo plina.finance. Nossa equipe responderá por e-mail assim que possível. Este e-mail confirma o recebimento; não é oferta nem solicitação de investimento, e não há oferta em andamento.
              </p>
            </td>
          </tr>

          <!-- Próximos passos -->
          <tr>
            <td style="padding:40px 40px 0 40px;">
              <div style="border-top:1px solid ${COLORS.hairline};line-height:0;font-size:0;height:1px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 0 40px;">
              <p style="margin:0 0 24px 0;font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${COLORS.cyanDeep};font-weight:700;">
                Próximos passos
              </p>
              ${passosHtml}
            </td>
          </tr>

          <!-- Resumo -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <div style="border-top:1px solid ${COLORS.hairline};line-height:0;font-size:0;height:1px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 0 40px;">
              <p style="margin:0 0 20px 0;font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${COLORS.cyanDeep};font-weight:700;">
                Resumo do contato
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.grey};border:1px solid ${COLORS.hairline};">
                ${resumoRows}
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:36px 40px 40px 40px;">
              <p style="margin:0;font-family:${SANS};font-size:14px;color:${COLORS.petrol70};line-height:1.6;">
                Em caso de dúvidas, basta responder este e-mail ou escrever para
                <a href="mailto:contato@plina.finance" style="color:${COLORS.cyanDeep};text-decoration:none;border-bottom:1px solid ${COLORS.cyanDeep};">contato@plina.finance</a>.
              </p>
              <p style="margin:16px 0 0 0;font-family:${SANS};font-size:12px;color:${COLORS.petrol55};line-height:1.6;">
                Você recebeu esta mensagem porque preencheu o formulário em plina.finance. Para pedir acesso, correção ou eliminação dos seus dados, responda este e-mail.
              </p>
            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td style="background:${COLORS.petrol};padding:28px 40px;">
              <p style="margin:0 0 4px 0;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.015em;color:${COLORS.white};">
                Plina<span style="color:${COLORS.cyan};">.</span>
              </p>
              <p style="margin:0 0 16px 0;font-family:${SANS};font-size:13px;color:#A0A8A8;font-weight:400;">
                Cotas contempladas de consórcio, com registro verificável em rede de testes
              </p>
              <p style="margin:0;font-family:${MONO};font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:#7A8484;">
                Contato exploratório · Em desenvolvimento · Rede de testes
              </p>
            </td>
          </tr>

        </table>

        <!-- Outer postscript -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:20px 16px;font-family:${MONO};font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:${COLORS.petrol55};">
              Plina Finance · plina.finance
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

// ----------------------------------------------------------------
// Notificação interna pra equipe
// ----------------------------------------------------------------

const AVISO_REENVIO =
  'Reenvio de e-mail já cadastrado — dados do banco NÃO alterados; só corrigir após confirmar a identidade pelo e-mail do titular.';

export function renderInternalNotification(d: LeadData) {
  // Reenvio de e-mail já cadastrado: NÃO ecoa nenhum dado novo (nome, organização, telefone,
  // mensagem…) — pode ser de uma pessoa que não é a dona do e-mail. Só o aviso, o e-mail (que já
  // é o do cadastro) e a data (decisão do Atlas e da Norma).
  if (d.reenvio) {
    const subject = '[Plina · Contato · reenvio]';
    const recebido = fmtDateBR(d.recebido);
    const text = [AVISO_REENVIO, ``, `E-mail: ${d.email}`, `Recebido: ${d.recebido}`].join('\n');
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:${COLORS.pageGrey};font-family:${SANS};color:${COLORS.petrol};">
  <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;font-weight:600;">${esc(AVISO_REENVIO)}</p>
  <p style="margin:0 0 4px 0;font-size:14px;line-height:1.5;">E-mail: ${esc(d.email)}</p>
  <p style="margin:0;font-size:14px;line-height:1.5;color:${COLORS.petrol70};">Recebido: ${esc(recebido)}</p>
</body>
</html>`;
    return { subject, text, html };
  }

  const subject = `[Plina · Contato] ${d.org}`;

  const lines = [
    `Novo contato recebido via plina.finance`,
    ``,
    `Nome: ${d.name}`,
    `E-mail: ${d.email}`,
    `Organização: ${d.org}`,
    `Perfil: ${d.profile}`,
    ...(d.ticket ? [`Tíquete: ${d.ticket}`] : []),
    ...(d.phone ? [`Telefone: ${d.phone}`] : []),
    ...(d.jurisdiction ? [`Jurisdição: ${d.jurisdiction}`] : []),
    ...(d.currency ? [`Moeda de preferência: ${d.currency}`] : []),
    ...(d.classe ? [`Classe de interesse: ${d.classe}`] : []),
    ...(d.timeline ? [`Prazo de decisão: ${d.timeline}`] : []),
    ...(d.notes ? [``, `Observações:`, d.notes] : []),
    ``,
    `Recebido: ${d.recebido}`,
  ];
  const text = lines.join('\n');

  const dataRows: Array<[string, string, boolean]> = [
    ['Nome', d.name, false],
    ['E-mail', d.email, true],
    ['Organização', d.org, false],
    ['Perfil', d.profile, false],
    ...(d.ticket ? [['Tíquete', d.ticket, false] as [string, string, boolean]] : []),
    ...(d.phone ? [['Telefone', d.phone, false] as [string, string, boolean]] : []),
    ...(d.jurisdiction ? [['Jurisdição', d.jurisdiction, false] as [string, string, boolean]] : []),
    ...(d.currency ? [['Moeda', d.currency, false] as [string, string, boolean]] : []),
    ...(d.classe ? [['Classe', d.classe, false] as [string, string, boolean]] : []),
    ...(d.timeline ? [['Prazo', d.timeline, false] as [string, string, boolean]] : []),
  ];

  const rowsHtml = dataRows
    .map(
      ([k, v, isMail], i) => `
        <tr>
          <td style="padding:13px 20px;font-family:${MONO};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${COLORS.petrol55};font-weight:700;${
            i === dataRows.length - 1 && !d.notes ? '' : `border-bottom:1px solid ${COLORS.hairline};`
          }width:36%;vertical-align:top;">
            ${esc(k)}
          </td>
          <td style="padding:13px 20px;font-family:${MONO};font-size:13px;color:${COLORS.petrol};font-weight:500;${
            i === dataRows.length - 1 && !d.notes ? '' : `border-bottom:1px solid ${COLORS.hairline};`
          }">
            ${
              isMail
                ? `<a href="mailto:${esc(v)}" style="color:${COLORS.cyanDeep};text-decoration:none;border-bottom:1px solid ${COLORS.cyanDeep};">${esc(v)}</a>`
                : esc(v)
            }
          </td>
        </tr>`
    )
    .join('');

  const notesHtml = d.notes
    ? `
          <tr>
            <td colspan="2" style="padding:13px 20px;font-family:${SANS};font-size:13px;color:${COLORS.petrol70};line-height:1.6;white-space:pre-wrap;">
              <span style="font-family:${MONO};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${COLORS.petrol55};font-weight:700;display:block;margin-bottom:6px;">Observações</span>
              ${esc(d.notes)}
            </td>
          </tr>`
    : '';

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageGrey};font-family:${SANS};color:${COLORS.petrol};-webkit-font-smoothing:antialiased;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Novo contato de ${esc(d.org)} (${esc(d.profile)}).
  </span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.pageGrey};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${COLORS.white};border:1px solid ${COLORS.hairline};">

          <!-- Header bar -->
          <tr>
            <td style="background:${COLORS.petrol};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:18px 32px;font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${COLORS.cyan};font-weight:700;">
                    [contato] · Novo contato
                  </td>
                  <td align="right" style="padding:18px 32px;font-family:${MONO};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#A0A8A8;">
                    ${esc(fmtDateBR(d.recebido))}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Organização como hero -->
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <p style="margin:0 0 8px 0;font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${COLORS.cyanDeep};font-weight:700;">
                Organização
              </p>
              <h1 style="margin:0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${COLORS.petrol};">
                ${esc(d.org)}
              </h1>
            </td>
          </tr>

          <!-- Data table -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.grey};border:1px solid ${COLORS.hairline};">
                ${rowsHtml}
                ${notesHtml}
              </table>
            </td>
          </tr>

          <!-- Reply hint -->
          <tr>
            <td style="padding:28px 32px 36px 32px;">
              <p style="margin:0;font-family:${SANS};font-size:14px;color:${COLORS.petrol70};line-height:1.55;">
                Responda diretamente para
                <a href="mailto:${esc(d.email)}" style="color:${COLORS.cyanDeep};text-decoration:none;border-bottom:1px solid ${COLORS.cyanDeep};">${esc(d.email)}</a>
                — o reply-to já está configurado.
              </p>
            </td>
          </tr>

          <!-- Footer hairline + meta -->
          <tr>
            <td style="background:${COLORS.grey};padding:14px 32px;border-top:1px solid ${COLORS.hairline};">
              <p style="margin:0;font-family:${MONO};font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:${COLORS.petrol55};">
                plina.finance · contato
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
