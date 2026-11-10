import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const sendMail = vi.hoisted(() => vi.fn());
const consume = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db: { leadEoi: { create, update } } }));
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
  update.mockResolvedValue({});
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

  it('reenvio de e-mail já cadastrado: dados NÃO alterados (só o carimbo), interno marcado, SEM auto-resposta, log sem PII', async () => {
    create.mockRejectedValue(Object.assign(new Error('Unique constraint failed on email fulana@example.com'), { code: 'P2002' }));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, notes: 'dados novos' }));
    expect(r).toEqual({ status: 'success' });

    // nada de nome/org/telefone/perfil no banco: só o carimbo de último contato
    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0];
    expect(where).toEqual({ email: 'fulana@example.com' });
    expect(Object.keys(data)).toEqual(['atualizadoEm']);

    // o time vê o reenvio e os dados novos no e-mail interno
    const interno = sendMail.mock.calls[0][0];
    expect(interno.subject).toBe('[Plina · Contato · reenvio] Family Office Exemplo');
    const AVISO = 'Reenvio de e-mail já cadastrado — dados do banco NÃO alterados; só corrigir após confirmar a identidade pelo e-mail do titular.';
    expect(interno.text.split('\n')[0]).toBe(AVISO); // 1ª linha
    expect(interno.html).toContain('NÃO alterados');
    // sem auto-resposta ao e-mail de terceiros: só o e-mail interno sai
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).not.toBe('fulana@example.com');
    expect(interno.text).toContain('dados novos');

    // F2: o log leva só o código, nunca e-mail, nome ou telefone
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).not.toMatch(/fulana|Fulana|example\.com/);
  });

  it('outro erro do banco (não P2002) NÃO é reenvio: segue o fluxo normal, com auto-resposta e sem carimbo', async () => {
    create.mockRejectedValue(Object.assign(new Error('conexão caiu'), { code: 'P1001' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(r).toEqual({ status: 'success' });
    expect(update).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0].subject).not.toContain('reenvio');
  });

  it('lead novo não é marcado como reenvio e não carimba nada', async () => {
    await submitLead(INICIAL, form(OBRIGATORIOS));
    expect(update).not.toHaveBeenCalled();
    expect(sendMail.mock.calls[0][0].subject).toBe('[Plina · Contato] Family Office Exemplo');
    expect(sendMail.mock.calls[0][0].text).not.toContain('Reenvio de e-mail');
    expect(sendMail).toHaveBeenCalledTimes(2); // interno + auto-resposta
  });

  it('campo extra no FormData é recusado pelo Zod strict; as chaves internas $ACTION_* do Next passam', async () => {
    const r = await submitLead(INICIAL, form({ ...OBRIGATORIOS, admin: '1' }));
    expect(r.status).toBe('error');
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    const ok = await submitLead(INICIAL, form({ ...OBRIGATORIOS, $ACTION_ID_abc123: '', $ACTION_REF_1: '1' }));
    expect(ok).toEqual({ status: 'success' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

