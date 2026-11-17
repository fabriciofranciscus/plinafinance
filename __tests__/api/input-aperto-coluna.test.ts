/**
 * I3 itens 1 e 5: valorCarta / deságio nas rotas admin/originacao e vender/simular com o limite da COLUNA
 * (Decimal(15,2) e Decimal(5,4)), no schema Zod da rota (antes: regex numérica sem teto nem limite de casas).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ gerar: vi.fn(), previa: vi.fn(), incorporar: vi.fn(), isAdmin: vi.fn(), csrf: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: m.isAdmin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: m.csrf }));
vi.mock('@/lib/services/originacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/originacao')>()),
  gerarOferta: m.gerar, comporDesagioDaOferta: m.previa, incorporarCotaDoFunil: m.incorporar,
}));
vi.mock('@/lib/services/tesouraria-legada', () => ({ registrarTesourariaLegada: vi.fn() }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: async () => true }, clientIp: () => 'ip' }));

import { POST as ADMIN } from '@/app/api/admin/originacao/route';
import { POST as SIMULAR } from '@/app/api/vender/simular/route';

const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const GERAR = { action: 'gerar-oferta', leadVendedorId: 'l1', tipoBem: 'IMOVEL', administradora: 'Porto', valorCarta: '100000', desagioAquisicao: '0.20' };
const PREVIA = { action: 'previa-oferta', administradora: 'Porto', valorCarta: '100000', desagioAquisicao: '0.20' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const f of [m.gerar, m.previa, m.incorporar]) f.mockReset();
  m.gerar.mockResolvedValue({ id: 'o1' });
  m.isAdmin.mockReset().mockResolvedValue(true);
  m.csrf.mockReset().mockReturnValue(null);
});

describe('admin/originacao — valorCarta (Decimal(15,2))', () => {
  for (const [nome, base] of [['gerar-oferta', GERAR], ['previa-oferta', PREVIA]] as const) {
    it.each(['8', '500', '1234', '1234.5', '1234.56', '9999999999999.99'])(`${nome}: aceita ${'%s'} (o R$ 8 da cota 2, R$ 500, R$ 1.234…)`, async (v) => {
      const r = await ADMIN(post('/api/admin/originacao', { ...base, valorCarta: v }));
      expect(r.status).not.toBe(400);
    });
    it.each(['10000000000000', '1234.567', '1e3', '-5', '0x10', ' 5'])(`${nome}: recusa ${'%s'} com 400 antes do serviço`, async (v) => {
      const r = await ADMIN(post('/api/admin/originacao', { ...base, valorCarta: v }));
      expect(r.status).toBe(400);
      expect(m.gerar).not.toHaveBeenCalled();
    });
  }
});

describe('admin/originacao — deságio (formato Decimal(5,4); a faixa [0,1] segue no serviço com 422 e code, A-22)', () => {
  it.each(['0', '0.2', '0.2345', '1', '2'])('gerar-oferta: %s passa o formato (a faixa é do serviço)', async (v) => {
    const r = await ADMIN(post('/api/admin/originacao', { ...GERAR, desagioAquisicao: v }));
    expect(r.status).not.toBe(400);
  });
  it.each(['0.12345', '10', '-0.1', '1e0'])('gerar-oferta: recusa %s com 400', async (v) => {
    const r = await ADMIN(post('/api/admin/originacao', { ...GERAR, desagioAquisicao: v }));
    expect(r.status).toBe(400);
    expect(m.gerar).not.toHaveBeenCalled();
  });
  it.each(['0', '0.37', '1'])('incorporar-cota: desagioRevenda %s aceito', async (v) => {
    const r = await ADMIN(post('/api/admin/originacao', { action: 'incorporar-cota', cessaoId: 'c1', desagioRevenda: v }));
    expect(r.status).not.toBe(400);
  });
  it.each(['-0.1', '1.5', '9', '0.12345', '1e0'])('incorporar-cota: desagioRevenda %s recusado (ressalva BAIXA do Argus)', async (v) => {
    const r = await ADMIN(post('/api/admin/originacao', { action: 'incorporar-cota', cessaoId: 'c1', desagioRevenda: v }));
    expect(r.status).toBe(400);
    expect(m.incorporar).not.toHaveBeenCalled();
  });
});

describe('vender/simular — valorCarta (Decimal(15,2), pública)', () => {
  it.each(['8', '500', '1234.56', '9999999999999.99'])('aceita %s', async (v) => {
    const r = await SIMULAR(post('/api/vender/simular', { tipoBem: 'IMOVEL', valorCarta: v }));
    expect(r.status).not.toBe(400);
  });
  it.each(['10000000000000', '99999999999999999999999999', '1234.567', '1e3', '0', '-5'])('recusa %s com 400', async (v) => {
    const r = await SIMULAR(post('/api/vender/simular', { tipoBem: 'IMOVEL', valorCarta: v }));
    expect(r.status).toBe(400);
  });
});
