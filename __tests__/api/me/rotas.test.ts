import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ consume: vi.fn(), resumo: vi.fn(), historico: vi.fn(), auth401: false }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: { user: unknown }) => Promise<Response>) => async (req: Request) =>
    m.auth401 ? Response.json({ error: 'token Privy ausente' }, { status: 401 }) : h(req, { user: { pessoaId: 'p_1' } }),
}));
vi.mock('@/lib/services/me', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/me')>()),
  montarResumo: m.resumo,
  montarHistorico: m.historico,
}));

import { GET as resumo } from '@/app/api/me/resumo/route';
import { GET as historico } from '@/app/api/me/historico/route';
import { CursorInvalidoError } from '@/lib/services/me';

const get = (path: string, fn: (r: Request) => Promise<Response>) => fn(new Request(`http://x${path}`));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.auth401 = false;
  m.consume.mockReset().mockResolvedValue(true);
  m.resumo.mockReset().mockResolvedValue({ nome: null, papeis: [], posicao: null, solicitacoes: [], operacoesPendentes: [], bloqueio: null });
  m.historico.mockReset().mockResolvedValue({ itens: [], proximoCursor: null });
});

describe.each([['/api/me/resumo', resumo, () => m.resumo], ['/api/me/historico', historico, () => m.historico]] as const)('GET %s', (path, fn, svc) => {
  it('sem token → 401 e o serviço não roda', async () => {
    m.auth401 = true;
    expect((await get(path, fn)).status).toBe(401);
    expect(svc()).not.toHaveBeenCalled();
  });
  it('rate limit estourado → 429 sem rodar o serviço', async () => {
    m.consume.mockResolvedValue(false);
    expect((await get(path, fn)).status).toBe(429);
    expect(m.consume).toHaveBeenCalledWith('203.0.113.9');
    expect(svc()).not.toHaveBeenCalled();
  });
  it('erro interno → 500 fixo, sem vazar a causa', async () => {
    svc().mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await get(path, fn);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
  it('resposta DIRETA (sem envelope data/error)', async () => {
    const corpo = await (await get(path, fn)).json();
    expect(corpo.data).toBeUndefined();
    expect(corpo.error).toBeUndefined();
  });
});

describe('GET /api/me/historico — parâmetros', () => {
  it('cursor e limit válidos vão ao serviço (limit numérico)', async () => {
    await get('/api/me/historico?cursor=abc&limit=10', historico);
    expect(m.historico).toHaveBeenCalledWith({ pessoaId: 'p_1' }, { cursor: 'abc', limit: 10 });
  });
  it.each(['?limit=0', '?limit=51', '?limit=abc', '?limit=1.5', '?extra=1', `?cursor=${'a'.repeat(301)}`])('%s → 400 e o serviço não roda', async (q) => {
    expect((await get(`/api/me/historico${q}`, historico)).status).toBe(400);
    expect(m.historico).not.toHaveBeenCalled();
  });
  it('cursor inválido (decodificação) → 400 {error}', async () => {
    m.historico.mockRejectedValue(new CursorInvalidoError());
    const r = await get('/api/me/historico?cursor=lixo', historico);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'cursor inválido' });
  });
});
