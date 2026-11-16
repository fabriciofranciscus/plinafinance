/**
 * Templates de email transacional ao cedente (PRD §M1 F-M1-7).
 *
 * HTML inline minimalista (sem web fonts, sem alpha) pra compatibilidade ampla
 * de clientes de email. Um template por transição do funil.
 */

import { nomeDoCedente } from '@/lib/vender/nome';
import { STELLAR_NETWORK, txExplorerUrl } from '../stellar/config';

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

/** A-06: fora da mainnet o e-mail leva o aviso de que é demonstração (mesma regra do PDF da cessão). */
const AVISO_TESTES = 'Mensagem de demonstração (projeto em fase de testes, rede de testes): sem efeito jurídico nem financeiro.';
const emTestes = () => STELLAR_NETWORK !== 'PUBLIC';

/**
 * Corpo do e-mail "cota incorporada" por rede (Atlas/Norma): na rede de testes o pool é de demonstração; na mainnet o e-mail NÃO
 * pode dizer "demonstração" (mesma checagem de rede do rodapé). A versão da mainnet é validada pela Norma.
 */
const CORPO_CONCLUIDO_TESTNET = 'Sua cota foi incorporada ao pool de demonstração da Plina. Obrigado por vender sua cota com a Plina.';
const CORPO_CONCLUIDO_MAINNET = 'Sua cota foi incorporada ao pool da Plina. Obrigado por vender sua cota com a Plina.';

function acompanharUrl(leadId: string): string {
  return `${BASE_URL}/vender/acompanhar/${leadId}`;
}

const COPY: Record<
  CedenteEmailKind,
  { subject: string; titulo: string; corpo: string }
> = {
  oferta: {
    subject: 'Sua proposta Plina está pronta',
    titulo: 'Proposta disponível',
    corpo: 'Preparamos uma proposta para a sua cota. Confira os valores e acompanhe o andamento pelo link abaixo.',
  },
  cessao: {
    subject: 'Cessão registrada — Plina',
    titulo: 'Cessão assinada e registrada',
    corpo: 'Sua cessão foi registrada na rede de testes. O pagamento segue as próximas etapas; avisaremos por e-mail nos principais avanços.',
  },
  pix: {
    subject: 'Pix executado — Plina',
    titulo: 'Pagamento enviado',
    corpo: 'O Pix referente à sua cessão foi executado. O comprovante está disponível no link abaixo.',
  },
  concluido: {
    subject: 'Cota incorporada ao pool — Plina',
    titulo: 'Operação concluída',
    corpo: CORPO_CONCLUIDO_TESTNET, // na mainnet, renderCedenteEmail troca por CORPO_CONCLUIDO_MAINNET
  },
};

export function renderCedenteEmail(
  kind: CedenteEmailKind,
  data: CedenteEmailData,
): { subject: string; text: string; html: string } {
  const c = COPY[kind];
  const corpo = kind === 'concluido' && !emTestes() ? CORPO_CONCLUIDO_MAINNET : c.corpo;
  const url = acompanharUrl(data.leadId);
  // Nunca e-mail (nem o marcador de 'sem nome') como nome: saudação neutra (pós-cota 15/11).
  const nome = nomeDoCedente(data.nome);
  const saudacao = nome ? `Olá, ${nome}.` : 'Olá.';

  const linhas: string[] = [];
  if (data.valorLiquido) linhas.push(`Valor líquido: ${data.valorLiquido}`);
  if (data.desagioPct) linhas.push(`Deságio aplicado: ${data.desagioPct}`);
  if (data.onChainTxHash)
    linhas.push(`Prova on-chain: ${txExplorerUrl(data.onChainTxHash)}`);
  if (data.comprovanteUrl) linhas.push(`Comprovante: ${data.comprovanteUrl}`);

  const text = [
    saudacao,
    '',
    corpo,
    '',
    ...linhas,
    '',
    `Acompanhe sua solicitação: ${url}`,
    '',
    'Plina Finance',
    ...(emTestes() ? [AVISO_TESTES] : []),
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
      <p style="margin:0 0 16px;font-size:14px;color:#132728;line-height:1.5;">${escapeHtml(corpo)}</p>
      ${detalhesHtml}
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">
      <a href="${url}" style="display:inline-block;background:#132728;color:#e4e4e4;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;">Acompanhar minha solicitação</a>
    </td></tr>
    ${emTestes() ? `<tr><td style="padding:0 28px 24px;"><p style="margin:0;font-size:11px;color:#888;line-height:1.4;">${escapeHtml(AVISO_TESTES)}</p></td></tr>` : ''}
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
