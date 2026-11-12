import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ varrer: vi.fn(), marcar: vi.fn(), alerta: vi.fn(), consume: vi.fn() }));
vi.mock('@/lib/services/pix-saida-varredor', () => ({ varrerPixSaida: m.varrer, marcarPixAvisados: m.marcar }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: m.alerta }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));

import { GET } from '@/app/api/ops/pix-saida/route';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const BASE = { avancadas: 1, comprovadas: 0, erros: 0, processando: 1, incertos: 0, valorDiverge: 0, semE2eId: 0, processandoAntigas: 0, alerta: false, paraAvisar: [] as string[] };
const req = (auth?: string) => new Request('http://x/api/ops/pix-saida', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.OPS_CRON_SECRET = SECRET;
  m.varrer.mockReset().mockResolvedValue(BASE);
  m.marcar.mockReset().mockResolvedValue(undefined);
  m.alerta.mockReset().mockResolvedValue(true);
  m.consume.mockReset().mockResolvedValue(true);
});
afterEach(() => { delete process.env.OPS_CRON_SECRET; });

describe('GET /api/ops/pix-saida', () => {
  it('Bearer certo → 200 só com contagens, sem ids nem lista', async () => {
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ avancadas: 1, comprovadas: 0, erros: 0, processando: 1, incertos: 0, valorDiverge: 0, semE2eId: 0, processandoAntigas: 0, alerta: false, alertaEnviado: false });
    expect(m.alerta).not.toHaveBeenCalled();
  });

  it.each([['sem header', undefined], ['errado', 'Bearer ' + 'x'.repeat(64)]])('%s → 404 e o varredor nem roda', async (_n, auth) => {
    expect((await GET(req(auth))).status).toBe(404);
    expect(m.varrer).not.toHaveBeenCalled();
  });

  it('secret fraco → 404; rate limit → 429', async () => {
    process.env.OPS_CRON_SECRET = 'curto';
    expect((await GET(req('Bearer curto'))).status).toBe(404);
    process.env.OPS_CRON_SECRET = SECRET;
    m.consume.mockResolvedValue(false);
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(429);
    expect(m.varrer).not.toHaveBeenCalled();
  });

  it('alerta novo: e-mail com ids internos de cessão (sem chave Pix/PII), marca avisado só depois de ENTREGUE; a resposta não tem os ids', async () => {
    m.varrer.mockResolvedValue({ ...BASE, incertos: 1, alerta: true, paraAvisar: ['cessao_9'] });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: true, incertos: 1 });
    expect(JSON.stringify(body)).not.toMatch(/cessao_9/);
    expect(m.alerta.mock.calls[0][0].linhas.join('\n')).toContain('cessão: cessao_9');
    expect(m.marcar).toHaveBeenCalledWith(['cessao_9']);
  });

  it('e-mail NÃO entregue: não marca avisado (o próximo ciclo tenta de novo) e alerta continua true', async () => {
    m.alerta.mockResolvedValue(false);
    m.varrer.mockResolvedValue({ ...BASE, valorDiverge: 1, alerta: true, paraAvisar: ['c1'] });
    expect(await (await GET(req(`Bearer ${SECRET}`))).json()).toMatchObject({ alerta: true, alertaEnviado: false });
    expect(m.marcar).not.toHaveBeenCalled();
  });

  it('já avisado antes: alerta true sem novo e-mail', async () => {
    m.varrer.mockResolvedValue({ ...BASE, incertos: 1, alerta: true, paraAvisar: [] });
    expect(await (await GET(req(`Bearer ${SECRET}`))).json()).toMatchObject({ alerta: true, alertaEnviado: false });
    expect(m.alerta).not.toHaveBeenCalled();
  });

  it('erro inesperado → 500 sem vazar a causa', async () => {
    m.varrer.mockRejectedValue(new Error('postgres://u:s@h'));
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/postgres/);
  });
});
