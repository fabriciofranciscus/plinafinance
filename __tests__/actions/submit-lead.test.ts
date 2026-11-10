import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.hoisted(() => vi.fn());
const sendMail = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db: { leadEoi: { upsert } } }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { submitLead } from '@/app/actions/submit-lead';

const INICIAL = { status: 'idle' as const };

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const OBRIGATORIOS = {
  name: 'Fulana de Teste',
  org: 'Family Office Exemplo',
  email: 'fulana@example.com',
  profile: 'family-office-br',
  lgpd: 'on',
};

beforeEach(() => {
  process.env.SMTP_HOST = 'smtp.exemplo.test';
  process.env.SMTP_USER = 'landing@exemplo.test';
  process.env.SMTP_PASS = 'x';
  upsert.mockResolvedValue({});
  sendMail.mockResolvedValue({});
});

describe('submitLead — tíquete, moeda, classe e prazo opcionais (LD0)', () => {
  it('aceita só nome, organização, e-mail e perfil; o resto vai como null e sai do e-mail', async () => {
    const r = await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(r).toEqual({ status: 'success' });

    const { create, update } = upsert.mock.calls[0][0];
    for (const dados of [create, update]) {
      expect(dados.ticket).toBeNull();
      expect(dados.currency).toBeNull();
      expect(dados.classe).toBeNull();
      expect(dados.timeline).toBeNull();
    }

    const [interno, resposta] = sendMail.mock.calls.map((c) => c[0]);
    expect(interno.text).toContain('Tíquete: não informado');
    expect(interno.text).not.toContain('Moeda de preferência');
    expect(interno.text).not.toContain('Classe de interesse');
    expect(interno.text).not.toContain('Prazo de decisão');
    expect(interno.html).toContain('não informado');
    expect(interno.html).not.toContain('undefined');
    expect(resposta.text).not.toContain('Tíquete');
    expect(resposta.html).not.toContain('Tíquete');
    expect(resposta.html).not.toContain('undefined');
  });

  it('valores antigos que ainda vierem continuam aceitos, gravados e no e-mail', async () => {
    const r = await submitLead(
      INICIAL,
      form({ ...OBRIGATORIOS, ticket: '1m-5m', currency: 'USD', classe: 'A', timeline: '3 meses' }),
    );
    expect(r).toEqual({ status: 'success' });

    const { create } = upsert.mock.calls[0][0];
    expect(create).toMatchObject({ ticket: 'US$ 1M – 5M', currency: 'USD', classe: 'A', timeline: '3 meses' });

    const [interno, resposta] = sendMail.mock.calls.map((c) => c[0]);
    expect(interno.text).toContain('Tíquete: US$ 1M – 5M');
    expect(interno.text).toContain('Moeda de preferência: USD');
    expect(interno.text).toContain('Classe de interesse: A');
    expect(interno.text).toContain('Prazo de decisão: 3 meses');
    expect(resposta.text).toContain('Tíquete indicativo: US$ 1M – 5M');
  });

  it('tíquete que vier fora da lista continua rejeitado, sem gravar nem enviar', async () => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, ticket: 'qualquer-coisa' }));
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/tíquete/i);
    expect(upsert).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each(['name', 'org', 'email', 'profile'] as const)('continua exigindo %s', async (campo) => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, [campo]: '' }));
    expect(r.status).toBe('error');
    expect(upsert).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('continua validando e-mail, perfil e o aceite LGPD', async () => {
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, email: 'invalido' }))).message).toMatch(/e-mail/i);
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, profile: 'xyz' }))).message).toMatch(/perfil/i);
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, lgpd: '' }))).message).toMatch(/LGPD/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('honeypot preenchido: sucesso silencioso, sem gravar nem enviar', async () => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, website: 'http://spam.example' }));
    expect(r).toEqual({ status: 'success' });
    expect(upsert).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
