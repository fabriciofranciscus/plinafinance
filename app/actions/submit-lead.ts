'use server';

import nodemailer from 'nodemailer';
import {
  renderInternalNotification,
  renderInvestorReply,
  type LeadData,
} from './email-templates';
import { db } from '@/lib/db';

export type LeadState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

const PROFILES_VALIDOS = new Set([
  'family-office-br',
  'family-office-int',
  'gestora-br',
  'gestora-int',
  'fintech-latam',
  'outro',
]);

const TICKETS_VALIDOS = new Set([
  '100k-500k',
  '500k-1m',
  '1m-5m',
  '5m+',
  '500k-2m-brl',
  '2m-10m-brl',
  '10m+brl',
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

const PROFILE_LABELS: Record<string, string> = {
  'family-office-br': 'Family office brasileiro',
  'family-office-int': 'Family office internacional',
  'gestora-br': 'Gestora de fundos (BR)',
  'gestora-int': 'Gestora multi-mercado (Internacional)',
  'fintech-latam': 'Fintech de investimento LATAM',
  'outro': 'Outro',
};

const TICKET_LABELS: Record<string, string> = {
  '100k-500k': 'US$ 100k – 500k',
  '500k-1m': 'US$ 500k – 1M',
  '1m-5m': 'US$ 1M – 5M',
  '5m+': 'US$ 5M+',
  '500k-2m-brl': 'R$ 500k – 2M',
  '2m-10m-brl': 'R$ 2M – 10M',
  '10m+brl': 'R$ 10M+',
};

export async function submitLead(
  _prev: LeadState,
  formData: FormData
): Promise<LeadState> {
  // Honeypot — bots tendem a preencher campos invisíveis.
  if (sanitize(formData.get('website'))) {
    return { status: 'success' };
  }

  const name = sanitize(formData.get('name'), 200);
  const org = sanitize(formData.get('org'), 200);
  const email = sanitize(formData.get('email'), 200);
  const phone = sanitize(formData.get('phone'), 50);
  const profile = sanitize(formData.get('profile'), 60);
  const jurisdiction = sanitize(formData.get('jurisdiction'), 100);
  const ticket = sanitize(formData.get('ticket'), 30);
  const currency = sanitize(formData.get('currency'), 30);
  const classe = sanitize(formData.get('classe'), 30);
  const timeline = sanitize(formData.get('timeline'), 30);
  const notes = sanitize(formData.get('notes'), 1000);
  const lgpd = formData.get('lgpd');

  if (!name || !org || !email || !profile || !ticket) {
    return { status: 'error', message: 'Preencha todos os campos obrigatórios.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'error', message: 'E-mail inválido.' };
  }

  if (!PROFILES_VALIDOS.has(profile)) {
    return { status: 'error', message: 'Selecione um perfil de investidor válido.' };
  }

  if (!TICKETS_VALIDOS.has(ticket)) {
    return { status: 'error', message: 'Selecione um tíquete indicativo válido.' };
  }

  if (lgpd !== 'on') {
    return { status: 'error', message: 'É necessário aceitar os termos de privacidade (LGPD).' };
  }

  const lead: LeadData = {
    name,
    org,
    email,
    phone: phone || undefined,
    profile: PROFILE_LABELS[profile] ?? profile,
    jurisdiction: jurisdiction || undefined,
    ticket: TICKET_LABELS[ticket] ?? ticket,
    currency: currency || undefined,
    classe: classe || undefined,
    timeline: timeline || undefined,
    notes: notes || undefined,
    recebido: new Date().toISOString(),
  };

  // Persiste no banco. Upsert por email — resubmissão atualiza sem duplicar.
  try {
    await db.leadEoi.upsert({
      where: { email: lead.email },
      update: {
        nome: lead.name,
        org: lead.org,
        telefone: lead.phone ?? null,
        perfil: lead.profile,
        jurisdiction: lead.jurisdiction ?? null,
        ticket: lead.ticket,
        currency: lead.currency ?? null,
        classe: lead.classe ?? null,
        timeline: lead.timeline ?? null,
        notes: lead.notes ?? null,
      },
      create: {
        nome: lead.name,
        org: lead.org,
        email: lead.email,
        telefone: lead.phone ?? null,
        perfil: lead.profile,
        jurisdiction: lead.jurisdiction ?? null,
        ticket: lead.ticket,
        currency: lead.currency ?? null,
        classe: lead.classe ?? null,
        timeline: lead.timeline ?? null,
        notes: lead.notes ?? null,
      },
    });
  } catch (err) {
    console.error('[submitLead] DB upsert error', err);
    // Não bloqueia o fluxo — e-mail ainda vai.
  }

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
