import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ publicar: vi.fn(), consume: vi.fn() }));
vi.mock('@/lib/services/snapshot-nav', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/snapshot-nav')>()),
  publicarSnapshotNav: m.publicar,
}));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));

import { POST } from '@/app/api/ops/snapshot-nav/route';
import { SnapshotNavError } from '@/lib/services/snapshot-nav';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OK = {
  publicado: true, reutilizada: false, data: '2026-11-12', sha256: 'b'.repeat(64), txHash: 'a'.repeat(64),
  url: 'https://blob.example/nav-snapshots/2026-11-12.json', navPorToken: '1.00000000', pendentes: 0,
};
const req = (auth?: string, method = 'POST') =>
  new Request('http://x/api/ops/snapshot-nav', { method, headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.OPS_CRON_SECRET = SECRET;
  m.publicar.mockReset().mockResolvedValue(OK);
  m.consume.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.OPS_CRON_SECRET;
});

describe('POST /api/ops/snapshot-nav', () => {
  it('Bearer certo → 200 com publicado:true, hash, txHash e URL (sem corpo do arquivo)', async () => {
    const r = await POST(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      publicado: true, alerta: false, reutilizada: false, data: '2026-11-12', sha256: 'b'.repeat(64),
      txHash: 'a'.repeat(64), url: OK.url, pendentes: 0,
    });
  });

  it('reexecução no dia → 200, publicado:true, reutilizada:true', async () => {
    m.publicar.mockResolvedValue({ ...OK, reutilizada: true });
    const body = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ publicado: true, alerta: false, reutilizada: true });
  });

  it('dia anterior pendente → 200 mas alerta:true (o workflow falha o job)', async () => {
    m.publicar.mockResolvedValue({ ...OK, pendentes: 1 });
    expect(await (await POST(req(`Bearer ${SECRET}`))).json()).toMatchObject({ publicado: true, alerta: true, pendentes: 1 });
  });

  it.each([
    ['sem header', undefined],
    ['secret errado', 'Bearer ' + 'x'.repeat(64)],
    ['esquema errado', `Basic ${SECRET}`],
  ])('%s → 404 e o serviço nem roda', async (_n, auth) => {
    const r = await POST(req(auth));
    expect(r.status).toBe(404);
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it('secret fraco no ambiente (< 32) → 404 mesmo com o header igual', async () => {
    process.env.OPS_CRON_SECRET = 'curto';
    expect((await POST(req('Bearer curto'))).status).toBe(404);
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it('rate limit estourado → 429 antes de olhar o secret', async () => {
    m.consume.mockResolvedValue(false);
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(429);
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it.each(['NAV_INDISPONIVEL', 'CONCILIACAO_DIVERGENTE', 'PUBLICACAO_FALHOU', 'ANCORA_FALHOU'] as const)(
    'gate/falha %s → 503 publicado:false alerta:true com o código, sem detalhe',
    async (code) => {
      m.publicar.mockRejectedValue(new SnapshotNavError(code, 'SUBORDINADA_CIRCULANDO'));
      const r = await POST(req(`Bearer ${SECRET}`));
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ publicado: false, alerta: true, codigo: code });
    },
  );

  it('execução em curso → 409 sem alerta', async () => {
    m.publicar.mockRejectedValue(new SnapshotNavError('EM_ANDAMENTO'));
    const r = await POST(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ publicado: false, alerta: false, codigo: 'EM_ANDAMENTO' });
  });

  it('erro inesperado → 500 sem vazar mensagem', async () => {
    m.publicar.mockRejectedValue(new Error('postgres://user:senha@host'));
    const r = await POST(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/postgres|senha/);
  });

  it('GET não existe (só POST)', async () => {
    const mod = await import('@/app/api/ops/snapshot-nav/route');
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
  });
});
