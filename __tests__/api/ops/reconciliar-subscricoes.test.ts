import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ reconciliar: vi.fn(), consume: vi.fn(), alerta: vi.fn() }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: m.alerta }));
vi.mock('@/lib/services/swap-escrituracao', () => ({ reconciliarSwapsOrfaos: m.reconciliar }));
vi.mock('@/lib/rate-limit/config', () => ({
  publicLimiter: { consume: m.consume },
  clientIp: () => '203.0.113.9',
}));

import { GET } from '@/app/api/ops/reconciliar-subscricoes/route';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 64 hex, como `openssl rand -hex 32`
const RESULTADO = {
  escriturados: 1, liberados: 1, aguardando: 0, vencidasSemProva: 0, semHash: 0,
  vigiaEscrituradas: 0, vigiaConflitos: 0, vigiaRestantes: 0, conflitoQuoteIds: [] as string[], erros: 0,
};
const req = (auth?: string) =>
  new Request('http://x/api/ops/reconciliar-subscricoes', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.OPS_CRON_SECRET = SECRET;
  m.reconciliar.mockReset().mockResolvedValue(RESULTADO);
  m.consume.mockReset().mockResolvedValue(true);
  m.alerta.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.OPS_CRON_SECRET;
});

describe('GET /api/ops/reconciliar-subscricoes', () => {
  it('com o Bearer certo → 200 e só as contagens', async () => {
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    const { conflitoQuoteIds: _ids, ...contagens } = RESULTADO;
    expect(await r.json()).toEqual({ ...contagens, alerta: false, alertaEnviado: false });
    expect(m.alerta).not.toHaveBeenCalled(); // sem conflito, sem e-mail
    expect(m.reconciliar).toHaveBeenCalledOnce();
  });

  it('conflito novo na vigia (emissão dupla): manda o e-mail de alerta com os ids e liga alerta na resposta (sem vazar os ids)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: true, vigiaConflitos: 1 });
    expect(body.conflitoQuoteIds).toBeUndefined(); // só contagens na resposta
    expect(m.alerta).toHaveBeenCalledOnce();
    const mail = m.alerta.mock.calls[0][0];
    expect(mail.assunto).toMatch(/emissão dupla/);
    expect(mail.linhas.join('\n')).toContain('quote: q_dup');
  });

  it('o e-mail de alerta falhar (sem SMTP) não derruba a rota: alerta true, alertaEnviado false', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    m.alerta.mockResolvedValue(false);
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ alerta: true, alertaEnviado: false });
  });

  it('sem header, com secret errado, sem o prefixo Bearer ou de tamanho diferente → 404, sem reconciliar', async () => {
    for (const auth of [undefined, 'Bearer errado', SECRET, 'Bearer ', `Bearer ${SECRET}x`, `Basic ${SECRET}`]) {
      const r = await GET(req(auth));
      expect(r.status, String(auth)).toBe(404);
    }
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('OPS_CRON_SECRET fraco (< 32 caracteres após o trim) = não configurado: 404 mesmo com o Bearer "certo"', async () => {
    for (const fraco of ['a', 'abcd', 'x'.repeat(31), `  ${'x'.repeat(31)}  `]) {
      process.env.OPS_CRON_SECRET = fraco;
      expect((await GET(req(`Bearer ${fraco.trim()}`))).status, JSON.stringify(fraco)).toBe(404);
    }
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('32 caracteres certos autorizam (e o trim do valor configurado é respeitado)', async () => {
    const forte = 'k'.repeat(32);
    process.env.OPS_CRON_SECRET = forte;
    expect((await GET(req(`Bearer ${forte}`))).status).toBe(200);
    process.env.OPS_CRON_SECRET = `  ${forte}  `;
    expect((await GET(req(`Bearer ${forte}`))).status).toBe(200);
    expect((await GET(req(`Bearer ${'k'.repeat(31)}j`))).status).toBe(404); // 32 chars, mas errado
  });

  it('a resposta traz vigiaRestantes (só contagem)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaRestantes: 70 });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body.vigiaRestantes).toBe(70);
  });

  it('sem OPS_CRON_SECRET configurado a rota não existe (404), mesmo com um Bearer qualquer', async () => {
    delete process.env.OPS_CRON_SECRET;
    expect((await GET(req('Bearer qualquer'))).status).toBe(404);
    expect((await GET(req('Bearer '))).status).toBe(404);
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('rate limit estourado → 429 ANTES de olhar o secret, sem reconciliar', async () => {
    m.consume.mockResolvedValue(false);
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(429);
    expect(m.reconciliar).not.toHaveBeenCalled();
    expect(m.consume).toHaveBeenCalledWith('203.0.113.9');
  });

  it('erro interno → 500 fixo, sem vazar a causa', async () => {
    m.reconciliar.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('SEGREDO');
  });
});
