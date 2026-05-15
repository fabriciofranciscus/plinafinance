// Templates de e-mail HTML para o fluxo de Lead Capture.
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
  nome: string;
  email: string;
  razao: string;
  cnpj: string; // já formatado
  tipo: string;
  aum: string;
  recebido: string; // ISO timestamp
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
  const firstName = d.nome.split(' ')[0];
  const subject = 'Plina · Aplicação recebida';

  const text = `${firstName},

Recebemos sua aplicação institucional via plina.finance. Nossa equipe de Relações com Investidores entrará em contato em até 2 dias úteis com o Prospecto, regulamento do FIDC e cronograma de Due Diligence.

Próximos passos:

  01 · Em até 2 dias úteis · Envio de Prospecto, regulamento do FIDC e cronograma de Due Diligence.
  02 · Roadshow institucional · Agendamento com o time fundador, com slots em São Paulo, Miami, Cingapura e Londres.
  03 · Onboarding formal · Habilitação institucional sob estrutura CVM 175, com prestadores registrados e auditoria Big Four.

Resumo da aplicação:

  Razão Social: ${d.razao}
  CNPJ: ${d.cnpj}
  Tipo de Instituição: ${d.tipo}
  Ativos sob Gestão: ${d.aum}

Em caso de dúvidas, basta responder este e-mail ou escrever para contato@plina.finance.

—
Plina Finance
Tokenizadora institucional de direito creditório
Oferta restrita · Investidor qualificado · Lei 11.795/2008 · CVM 175
`;

  const passos: Array<[string, string, string]> = [
    [
      '01',
      'Em até 2 dias úteis',
      'Nossa equipe de Relações com Investidores envia Prospecto, regulamento do FIDC e cronograma de Due Diligence.',
    ],
    [
      '02',
      'Roadshow institucional',
      'Após análise inicial, agendamos com o time fundador. Slots em São Paulo, Miami, Cingapura e Londres.',
    ],
    [
      '03',
      'Onboarding formal',
      'Habilitação institucional sob estrutura CVM 175, com prestadores registrados e auditoria Big Four.',
    ],
  ];

  const resumo: Array<[string, string]> = [
    ['Razão Social', d.razao],
    ['CNPJ', d.cnpj],
    ['Tipo de Instituição', d.tipo],
    ['Ativos sob Gestão', d.aum],
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
    Recebemos sua aplicação institucional. Nossa equipe entrará em contato em até 2 dias úteis.
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
                    Aplicação recebida
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
                Recebemos sua aplicação institucional via plina.finance. Nossa equipe de Relações com Investidores entrará em contato em até 2 dias úteis com o Prospecto, regulamento do FIDC e cronograma de Due Diligence.
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
                Resumo da aplicação
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
            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td style="background:${COLORS.petrol};padding:28px 40px;">
              <p style="margin:0 0 4px 0;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.015em;color:${COLORS.white};">
                Plina<span style="color:${COLORS.cyan};">.</span>
              </p>
              <p style="margin:0 0 16px 0;font-family:${SANS};font-size:13px;color:#A0A8A8;font-weight:400;">
                Tokenizadora institucional de direito creditório
              </p>
              <p style="margin:0;font-family:${MONO};font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:#7A8484;">
                Oferta restrita · Investidor qualificado · Lei 11.795/2008 · CVM 175
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

export function renderInternalNotification(d: LeadData) {
  const subject = `[Plina · Lead] ${d.razao}`;

  const text = `Nova aplicação institucional recebida via plina.finance

Responsável Corporativo: ${d.nome}
E-mail: ${d.email}
Razão Social: ${d.razao}
CNPJ: ${d.cnpj}
Tipo de Instituição: ${d.tipo}
Ativos sob Gestão: ${d.aum}

Recebido: ${d.recebido}
`;

  const dataRows: Array<[string, string, boolean]> = [
    ['Responsável', d.nome, false],
    ['E-mail', d.email, true],
    ['Razão Social', d.razao, false],
    ['CNPJ', d.cnpj, false],
    ['Tipo', d.tipo, false],
    ['AUM', d.aum, false],
  ];

  const rowsHtml = dataRows
    .map(
      ([k, v, isMail], i) => `
        <tr>
          <td style="padding:13px 20px;font-family:${MONO};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${COLORS.petrol55};font-weight:700;${
            i === dataRows.length - 1 ? '' : `border-bottom:1px solid ${COLORS.hairline};`
          }width:36%;vertical-align:top;">
            ${esc(k)}
          </td>
          <td style="padding:13px 20px;font-family:${MONO};font-size:13px;color:${COLORS.petrol};font-weight:500;${
            i === dataRows.length - 1 ? '' : `border-bottom:1px solid ${COLORS.hairline};`
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

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageGrey};font-family:${SANS};color:${COLORS.petrol};-webkit-font-smoothing:antialiased;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Nova aplicação de ${esc(d.razao)} (${esc(d.tipo)}, ${esc(d.aum)}).
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
                    [lead] · Nova aplicação
                  </td>
                  <td align="right" style="padding:18px 32px;font-family:${MONO};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#A0A8A8;">
                    ${esc(fmtDateBR(d.recebido))}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Razão Social como hero -->
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <p style="margin:0 0 8px 0;font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${COLORS.cyanDeep};font-weight:700;">
                Instituição
              </p>
              <h1 style="margin:0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${COLORS.petrol};">
                ${esc(d.razao)}
              </h1>
            </td>
          </tr>

          <!-- Data table -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.grey};border:1px solid ${COLORS.hairline};">
                ${rowsHtml}
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
                plina.finance · captação institucional · lead capture v1
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
