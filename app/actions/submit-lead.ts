'use server';

import nodemailer from 'nodemailer';
import {
  renderInternalNotification,
  renderInvestorReply,
  type LeadData,
} from './email-templates';

export type LeadState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

const TIPOS_VALIDOS = new Set([
  'Family Office',
  'Gestora Multimercado',
  'Custodiante Institucional',
  'Parceiro Estratégico',
  'Fintech LATAM',
  'Outro',
]);

const AUMS_VALIDOS = new Set([
  'Acima de R$ 50M',
  'Acima de R$ 100M',
  'Acima de R$ 500M',
  'Acima de US$ 100M',
]);

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP não configurado: defina SMTP_HOST, SMTP_USER, SMTP_PASS no ambiente.');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

function sanitize(raw: FormDataEntryValue | null, max = 500) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, max);
}

function isValidCNPJ(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const calcDigit = (slice: string, weights: number[]) => {
    const sum = weights.reduce(
      (acc, w, i) => acc + parseInt(slice[i], 10) * w,
      0
    );
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  if (calcDigit(digits.slice(0, 12), w1) !== parseInt(digits[12], 10)) {
    return false;
  }
  if (calcDigit(digits.slice(0, 13), w2) !== parseInt(digits[13], 10)) {
    return false;
  }
  return true;
}

function formatCNPJ(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export async function submitLead(
  _prev: LeadState,
  formData: FormData
): Promise<LeadState> {
  // Honeypot — bots tendem a preencher campos invisíveis.
  if (sanitize(formData.get('website'))) {
    return { status: 'success' };
  }

  const nome = sanitize(formData.get('nome'), 200);
  const email = sanitize(formData.get('email'), 200);
  const razao = sanitize(formData.get('razao'), 200);
  const cnpj = sanitize(formData.get('cnpj'), 30);
  const tipo = sanitize(formData.get('tipo'), 60);
  const aum = sanitize(formData.get('aum'), 60);

  if (!nome || !email || !razao || !cnpj || !tipo || !aum) {
    return { status: 'error', message: 'Preencha todos os campos.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'error', message: 'E-mail inválido.' };
  }

  if (!isValidCNPJ(cnpj)) {
    return { status: 'error', message: 'CNPJ inválido. Verifique os dígitos.' };
  }

  if (!TIPOS_VALIDOS.has(tipo) || !AUMS_VALIDOS.has(aum)) {
    return { status: 'error', message: 'Selecione tipo e AUM válidos.' };
  }

  const lead: LeadData = {
    nome,
    email,
    razao,
    cnpj: formatCNPJ(cnpj),
    tipo,
    aum,
    recebido: new Date().toISOString(),
  };

  let tx: nodemailer.Transporter;
  try {
    tx = getTransporter();
  } catch (err) {
    console.error('[submitLead] SMTP config error', err);
    return {
      status: 'error',
      message:
        'Serviço de envio temporariamente indisponível. Escreva para contato@plina.finance.',
    };
  }

  const internal = renderInternalNotification(lead);
  try {
    await tx.sendMail({
      from: `"Plina Landing" <${process.env.SMTP_USER}>`,
      to: process.env.LEAD_EMAIL_TO || process.env.SMTP_USER!,
      replyTo: email,
      subject: internal.subject,
      text: internal.text,
      html: internal.html,
    });
  } catch (err) {
    console.error('[submitLead] SMTP error (notificação interna)', err);
    return {
      status: 'error',
      message:
        'Falha ao enviar. Tente novamente em instantes ou escreva para contato@plina.finance.',
    };
  }

  // Auto-reply pro investidor. Se falhar, o lead já foi recebido — não devolvemos erro.
  const reply = renderInvestorReply(lead);
  try {
    await tx.sendMail({
      from: `"Plina Finance" <${process.env.SMTP_USER}>`,
      to: email,
      replyTo: process.env.SMTP_USER!,
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
    });
  } catch (err) {
    console.error('[submitLead] SMTP error (auto-reply)', err);
    // Não devolvemos erro pro usuário — a notificação interna já foi enviada.
  }

  return { status: 'success' };
}
