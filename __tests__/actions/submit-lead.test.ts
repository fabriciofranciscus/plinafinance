import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());
const sendMail = vi.hoisted(() => vi.fn());
const consume = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db: { leadEoi: { create } } }));
vi.mock('@/lib/rate-limit/config', () => ({ leadLimiter: { consume } }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
}));
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
  create.mockResolvedValue({});
  consume.mockResolvedValue(true);
  sendMail.mockResolvedValue({});
});

describe('submitLead — tíquete, moeda, classe e prazo opcionais (LD0)', () => {
  it('aceita só nome, organização, e-mail e perfil; o resto vai como null e sai do e-mail', async () => {
    const r = await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(r).toEqual({ status: 'success' });

    const { data: dados } = create.mock.calls[0][0];
    expect(dados.ticket).toBeNull();
    expect(dados.currency).toBeNull();
    expect(dados.classe).toBeNull();
    expect(dados.timeline).toBeNull();

    const [interno, resposta] = sendMail.mock.calls.map((c) => c[0]);
    expect(interno.text).not.toContain('Tíquete');
    expect(interno.text).not.toContain('Moeda de preferência');
    expect(interno.text).not.toContain('Classe de interesse');
    expect(interno.text).not.toContain('Prazo de decisão');
    expect(interno.html).not.toContain('Tíquete');
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

    const { data } = create.mock.calls[0][0];
    expect(data).toMatchObject({ ticket: 'US$ 1M – 5M', currency: 'USD', classe: 'A', timeline: '3 meses' });

    const [interno, resposta] = sendMail.mock.calls.map((c) => c[0]);
    expect(interno.text).toContain('Tíquete: US$ 1M – 5M');
    expect(interno.text).toContain('Moeda de preferência: USD');
    expect(interno.text).toContain('Classe de interesse: A');
    expect(interno.text).toContain('Prazo de decisão: 3 meses');
    // a auto-resposta ao lead NUNCA ecoa tíquete (contato exploratório, sem oferta)
    expect(resposta.text).not.toContain('Tíquete');
    expect(resposta.text).not.toContain('US$ 1M');
  });

  it('tíquete que vier fora da lista continua rejeitado, sem gravar nem enviar', async () => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, ticket: 'qualquer-coisa' }));
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/tíquete/i);
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each(['name', 'org', 'email', 'profile'] as const)('continua exigindo %s', async (campo) => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, [campo]: '' }));
    expect(r.status).toBe('error');
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('continua validando e-mail, perfil e o aceite LGPD', async () => {
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, email: 'invalido' }))).message).toMatch(/e-mail/i);
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, profile: 'xyz' }))).message).toMatch(/perfil/i);
    expect((await submitLead(INICIAL, form({ ...OBRIGATORIOS, lgpd: '' }))).message).toMatch(/LGPD/);
    expect(create).not.toHaveBeenCalled();
  });

  it('honeypot preenchido: sucesso silencioso, sem gravar nem enviar', async () => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, website: 'http://spam.example' }));
    expect(r).toEqual({ status: 'success' });
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('submitLead — rota pública (F1/F2 do Argus)', () => {
  it('limite por IP: estourou → erro, sem gravar nem enviar e-mail; usa o 1º IP do x-forwarded-for', async () => {
    consume.mockResolvedValue(false);
    const r = await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/muitas tentativas/i);
    expect(consume).toHaveBeenCalledWith('203.0.113.7');
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('honeypot responde sucesso sem consumir o limite', async () => {
    await submitLead(INICIAL, form({ ...OBRIGATORIOS, website: 'x' }));
    expect(consume).not.toHaveBeenCalled();
  });

  it('entrada fora dos limites é recusada (nome > 200, notas > 1000, e-mail > 254)', async () => {
    const casos: Array<Record<string, string>> = [
      { name: 'a'.repeat(201) },
      { notes: 'a'.repeat(1001) },
      { email: `${'a'.repeat(250)}@x.co` },
    ];
    for (const extra of casos) {
      const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, ...extra }));
      expect(r.status).toBe('error');
    }
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('lead já existente NÃO é sobrescrito (create, nunca upsert) e o e-mail interno ainda sai', async () => {
    create.mockRejectedValue(Object.assign(new Error('Unique constraint failed on email fulana@example.com'), { code: 'P2002' }));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(r).toEqual({ status: 'success' });
    expect(sendMail).toHaveBeenCalled();
    // F2: o log leva só o código, nunca e-mail, nome ou telefone
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).toContain('P2002');
    expect(logado).not.toMatch(/fulana|Fulana|example\.com/);
  });
});

