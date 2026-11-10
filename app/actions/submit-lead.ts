'use server';

import { headers } from 'next/headers';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import {
  renderInternalNotification,
  renderInvestorReply,
  type LeadData,
} from './email-templates';
import { db } from '@/lib/db';
import { leadLimiter } from '@/lib/rate-limit/config';

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

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() ?? 'unknown';
}

const PROFILES = [...PROFILES_VALIDOS] as [string, ...string[]];
const TICKETS = [...TICKETS_VALIDOS] as [string, ...string[]];

/** Obrigatórios: name, org, email, profile (+ aceite LGPD). Tíquete é opcional, mas segue a lista fechada. */
const LeadSchema = z
  .object({
    name: z.string().max(200),
    org: z.string().max(200),
    email: z.string().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'email'),
    phone: z.string().max(50).optional(),
    profile: z.enum(PROFILES),
    jurisdiction: z.string().max(100).optional(),
    ticket: z.enum(TICKETS).optional(),
    currency: z.string().max(30).optional(),
    classe: z.string().max(30).optional(),
    timeline: z.string().max(30).optional(),
    notes: z.string().max(1000).optional(),
    lgpd: z.literal('on'),
  })
  .strict();

/** Mantém as mensagens de antes, na mesma ordem de prioridade. */
function mensagemDeValidacao(erro: z.ZodError): string {
  const por = new Map(erro.issues.map((i) => [String(i.path[0]), i]));
  const obrigatorioAusente = ['name', 'org', 'email', 'profile'].some(
    (k) => por.get(k)?.code === 'invalid_type',
  );
  if (obrigatorioAusente) return 'Preencha todos os campos obrigatórios.';
  if (por.has('email')) return 'E-mail inválido.';
  if (por.has('profile')) return 'Selecione um perfil de investidor válido.';
  if (por.has('ticket')) return 'Selecione um tíquete indicativo válido.';
  if (por.has('lgpd')) return 'É necessário aceitar os termos de privacidade (LGPD).';
  return 'Verifique os dados informados e tente novamente.';
}

export async function submitLead(
  _prev: LeadState,
  formData: FormData
): Promise<LeadState> {
  // Honeypot — bots tendem a preencher campos invisíveis.
  if (sanitize(formData.get('website'))) {
    return { status: 'success' };
  }

  // Rota pública: limite por IP antes de qualquer trabalho (SMTP, banco).
  if (!(await leadLimiter.consume(await getClientIp()))) {
    return { status: 'error', message: 'Muitas tentativas. Aguarde um instante e tente de novo.' };
  }

  // Todas as chaves do FormData vão ao schema strict: campo desconhecido é recusado. Só as
  // chaves internas do Next ($ACTION_*) e o honeypot (já tratado acima) ficam de fora.
  const bruto: Record<string, unknown> = {};
  for (const [chave, valor] of formData.entries()) {
    if (chave.startsWith('$ACTION') || chave === 'website') continue;
    if (typeof valor !== 'string') {
      bruto[chave] = valor; // arquivo: o schema recusa
      continue;
    }
    const v = valor.trim();
    bruto[chave] = v === '' ? undefined : v;
  }
  const parsed = LeadSchema.safeParse(bruto);
  if (!parsed.success) {
    return { status: 'error', message: mensagemDeValidacao(parsed.error) };
  }
  const { name, org, email, phone, profile, jurisdiction, ticket, currency, classe, timeline, notes } =
    parsed.data;

  const lead: LeadData = {
    name,
    org,
    email,
    phone: phone || undefined,
    profile: PROFILE_LABELS[profile] ?? profile,
    jurisdiction: jurisdiction || undefined,
    ticket: ticket ? (TICKET_LABELS[ticket] ?? ticket) : undefined,
    currency: currency || undefined,
    classe: classe || undefined,
    timeline: timeline || undefined,
    notes: notes || undefined,
    recebido: new Date().toISOString(),
  };

  // Persiste no banco. NÃO sobrescreve lead existente: quem conhece o e-mail de outra pessoa
  // não pode trocar nome, organização e telefone dela (F1-c do Argus). Resubmissão do mesmo
  // e-mail mantém o registro original; a manifestação nova chega no e-mail interno.
  try {
    await db.leadEoi.create({
      data: {
        nome: lead.name,
        org: lead.org,
        email: lead.email,
        telefone: lead.phone ?? null,
        perfil: lead.profile,
        jurisdiction: lead.jurisdiction ?? null,
        ticket: lead.ticket ?? null,
        currency: lead.currency ?? null,
        classe: lead.classe ?? null,
        timeline: lead.timeline ?? null,
        notes: lead.notes ?? null,
      },
    });
  } catch (err) {
    // Só o código do erro: a mensagem do Prisma carrega e-mail, nome e telefone (PII).
    const codigo = (err as { code?: unknown } | null)?.code;
    if (codigo === 'P2002') {
      // Lead já existente: dados NÃO alterados; só o carimbo de último contato. O e-mail
      // interno marca o reenvio (os dados novos chegam lá, para o time decidir).
      lead.reenvio = true;
      try {
        await db.leadEoi.update({ where: { email: lead.email }, data: { atualizadoEm: new Date() } });
      } catch (err2) {
        const c2 = (err2 as { code?: unknown } | null)?.code;
        console.error('[submitLead] DB stamp error', typeof c2 === 'string' ? c2 : 'desconhecido');
      }
    } else {
      console.error('[submitLead] DB create error', typeof codigo === 'string' ? codigo : 'desconhecido');
    }
    // Não bloqueia o fluxo — o e-mail ainda vai.
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

  // Auto-reply ao lead. NÃO sai no reenvio de e-mail já cadastrado: o lead já recebeu uma, e
  // quem digita o e-mail de outra pessoa não pode usar o form para escrever a ela nem ver o
  // resumo ecoado (decisão da Norma). Outros erros do banco seguem o fluxo normal.
  if (!lead.reenvio) {
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

  }

  return { status: 'success' };
}
