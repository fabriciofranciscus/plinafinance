import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ reconciliar: vi.fn(), consume: vi.fn() }));
vi.mock('@/lib/services/swap-escrituracao', () => ({ reconciliarSwapsOrfaos: m.reconciliar }));
vi.mock('@/lib/rate-limit/config', () => ({
  publicLimiter: { consume: m.consume },
  clientIp: () => '203.0.113.9',
}));

import { GET } from '@/app/api/ops/reconciliar-subscricoes/route';

const SECRET = 'segredo-de-teste-ops';
const RESULTADO = {
  escriturados: 1, liberados: 1, aguardando: 0, vencidasSemProva: 0, semHash: 0,
  vigiaEscrituradas: 0, vigiaConflitos: 0, erros: 0,
};
const req = (auth?: string) =>
  new Request('http://x/api/ops/reconciliar-subscricoes', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.OPS_CRON_SECRET = SECRET;
  m.reconciliar.mockReset().mockResolvedValue(RESULTADO);
  m.consume.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.OPS_CRON_SECRET;
});

describe('GET /api/ops/reconciliar-subscricoes', () => {
  it('com o Bearer certo → 200 e só as contagens', async () => {
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ...RESULTADO, alerta: false });
    expect(m.reconciliar).toHaveBeenCalledOnce();
  });

  it('vigiaConflitos > 0 (emissão dupla) liga o alerta imediato na resposta', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1 });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body.alerta).toBe(true);
    expect(body.vigiaConflitos).toBe(1);
  });

  it('sem header, com secret errado, sem o prefixo Bearer ou de tamanho diferente → 404, sem reconciliar', async () => {
    for (const auth of [undefined, 'Bearer errado', SECRET, 'Bearer ', `Bearer ${SECRET}x`, `Basic ${SECRET}`]) {
      const r = await GET(req(auth));
      expect(r.status, String(auth)).toBe(404);
    }
    expect(m.reconciliar).not.toHaveBeenCalled();
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
