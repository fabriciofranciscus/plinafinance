/**
 * Templates de email transacional ao cedente (PRD §M1 F-M1-7).
 *
 * HTML inline minimalista (sem web fonts, sem alpha) pra compatibilidade ampla
 * de clientes de email. Um template por transição do funil.
 */

import { txExplorerUrl } from '../stellar/config';

export type CedenteEmailKind = 'oferta' | 'cessao' | 'pix' | 'concluido';

export interface CedenteEmailData {
  leadId: string;
  nome?: string | null;
  /** BRL já formatado (ex.: "R$ 120.000,00"). */
  valorLiquido?: string;
  /** Deságio em % já formatado (ex.: "19,50%"). */
  desagioPct?: string;
  onChainTxHash?: string | null;
  comprovanteUrl?: string | null;
}

const BASE_URL = process.env.APP_BASE_URL ?? 'https://plina.finance';

function acompanharUrl(leadId: string): string {
  return `${BASE_URL}/vender/acompanhar/${leadId}`;
}

const COPY: Record<
  CedenteEmailKind,
  { subject: string; titulo: string; corpo: string }
> = {
  oferta: {
    subject: 'Sua oferta Plina está pronta',
    titulo: 'Oferta firme disponível',
    corpo: 'Preparamos uma oferta firme para a sua cota. Confira os valores e acompanhe o andamento pelo link abaixo.',
  },
  cessao: {
    subject: 'Cessão registrada — Plina',
    titulo: 'Cessão assinada e registrada',
    corpo: 'Sua cessão foi registrada e o hash do documento foi gravado on-chain como prova pública. O Pix será executado em seguida.',
  },
  pix: {
    subject: 'Pix executado — Plina',
    titulo: 'Pagamento enviado',
    corpo: 'O Pix referente à sua cessão foi executado. O comprovante está disponível no link abaixo.',
  },
  concluido: {
    subject: 'Cota incorporada ao pool — Plina',
    titulo: 'Operação concluída',
    corpo: 'Sua cota foi incorporada ao pool tokenizado público da Plina. Obrigado por negociar com a gente.',
  },
};

export function renderCedenteEmail(
  kind: CedenteEmailKind,
  data: CedenteEmailData,
): { subject: string; text: string; html: string } {
  const c = COPY[kind];
  const url = acompanharUrl(data.leadId);
  const saudacao = data.nome ? `Olá, ${data.nome}.` : 'Olá.';

  const linhas: string[] = [];
  if (data.valorLiquido) linhas.push(`Valor líquido: ${data.valorLiquido}`);
  if (data.desagioPct) linhas.push(`Deságio aplicado: ${data.desagioPct}`);
  if (data.onChainTxHash)
    linhas.push(`Prova on-chain: ${txExplorerUrl(data.onChainTxHash)}`);
  if (data.comprovanteUrl) linhas.push(`Comprovante: ${data.comprovanteUrl}`);

  const text = [
    saudacao,
    '',
    c.corpo,
    '',
    ...linhas,
    '',
    `Acompanhe sua solicitação: ${url}`,
    '',
    'Plina Finance',
  ].join('\n');

  const detalhesHtml = linhas
    .map(
      (l) =>
        `<p style="margin:4px 0;font-size:13px;color:#444;">${escapeHtml(l)}</p>`,
    )
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#e4e4e4;padding:24px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d0d0d0;">
    <tr><td style="padding:28px 28px 12px;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#057A99;">Plina · solicitação de venda</p>
      <h1 style="margin:0;font-size:22px;color:#132728;">${escapeHtml(c.titulo)}</h1>
    </td></tr>
    <tr><td style="padding:8px 28px 0;">
      <p style="margin:0 0 12px;font-size:14px;color:#132728;">${escapeHtml(saudacao)}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#132728;line-height:1.5;">${escapeHtml(c.corpo)}</p>
      ${detalhesHtml}
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">
      <a href="${url}" style="display:inline-block;background:#132728;color:#e4e4e4;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;">Acompanhar minha solicitação</a>
    </td></tr>
  </table>
</body></html>`;

  return { subject: c.subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
