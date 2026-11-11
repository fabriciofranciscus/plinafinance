import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ find: vi.fn(), ler: vi.fn(), consume: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { snapshotNav: { findUnique: m.find } } }));
vi.mock('@/lib/integrations/blob/nav-snapshot', () => ({ lerArquivoSnapshot: m.ler }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));

import { GET } from '@/app/api/nav-snapshot/[data]/route';

const CORPO = '{"tipo":"plina.nav-snapshot","versao":1}';
const SHA = createHash('sha256').update(CORPO).digest('hex');
const chamar = (data: string) => GET(new Request('http://x'), { params: Promise.resolve({ data }) });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.consume.mockReset().mockResolvedValue(true);
  m.find.mockReset().mockResolvedValue({ status: 'PUBLICADO', sha256: SHA });
  m.ler.mockReset().mockResolvedValue(Buffer.from(CORPO, 'utf8'));
});

describe('GET /api/nav-snapshot/[data]', () => {
  it('devolve os bytes exatos do arquivo publicado (SHA-256 = o ancorado)', async () => {
    const r = await chamar('2026-11-12');
    expect(r.status).toBe(200);
    const corpo = Buffer.from(await r.arrayBuffer());
    expect(createHash('sha256').update(corpo).digest('hex')).toBe(SHA);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
  });
  it.each(['../etc', '2026-1-1', '2026-11-12.json', 'x'])('data inválida %s → 404 sem tocar no banco', async (d) => {
    expect((await chamar(d)).status).toBe(404);
    expect(m.find).not.toHaveBeenCalled();
  });
  it('snapshot inexistente ou ainda PUBLICANDO → 404', async () => {
    m.find.mockResolvedValue(null);
    expect((await chamar('2026-11-12')).status).toBe(404);
    m.find.mockResolvedValue({ status: 'PUBLICANDO', sha256: SHA });
    expect((await chamar('2026-11-12')).status).toBe(404);
    expect(m.ler).not.toHaveBeenCalled();
  });
  it('blob ausente → 404; blob que não bate com o hash gravado → 503 (nunca serve)', async () => {
    m.ler.mockResolvedValue(null);
    expect((await chamar('2026-11-12')).status).toBe(404);
    m.ler.mockResolvedValue(Buffer.from('{"adulterado":true}'));
    expect((await chamar('2026-11-12')).status).toBe(503);
  });
  it('rate limit → 429', async () => {
    m.consume.mockResolvedValue(false);
    expect((await chamar('2026-11-12')).status).toBe(429);
    expect(m.find).not.toHaveBeenCalled();
  });
  it('falha do banco → 503 sem vazar', async () => {
    m.find.mockRejectedValue(new Error('postgres://u:s@h'));
    const r = await chamar('2026-11-12');
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/postgres/);
  });
});
