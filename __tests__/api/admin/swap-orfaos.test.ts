import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const m = vi.hoisted(() => ({ isAdmin: vi.fn(), csrf: vi.fn(), reconciliar: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: m.isAdmin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: m.csrf }));
vi.mock('@/lib/services/swap-escrituracao', () => ({ reconciliarSwapsOrfaos: m.reconciliar }));

import { POST } from '@/app/api/admin/swap-orfaos/route';

const req = () => new Request('http://x/api/admin/swap-orfaos', { method: 'POST' });
const RESULTADO = { escriturados: 1, liberados: 2, aguardando: 0, vencidasSemProva: 1, semHash: 0, erros: 0 };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.isAdmin.mockReset().mockResolvedValue(true);
  m.csrf.mockReset().mockReturnValue(null);
  m.reconciliar.mockReset().mockResolvedValue(RESULTADO);
});

describe('POST /api/admin/swap-orfaos', () => {
  it('sem CSRF válido → a resposta do guard, sem reconciliar', async () => {
    m.csrf.mockReturnValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    const r = await POST(req());
    expect(r.status).toBe(403);
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('sem sessão admin → 401, sem reconciliar', async () => {
    m.isAdmin.mockResolvedValue(false);
    const r = await POST(req());
    expect(r.status).toBe(401);
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('admin → devolve só as contagens', async () => {
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RESULTADO);
  });

  it('erro interno → 500 fixo, sem vazar a causa', async () => {
    m.reconciliar.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('SEGREDO');
  });
});
