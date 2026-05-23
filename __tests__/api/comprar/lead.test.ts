import { describe, it, expect, vi, beforeEach } from 'vitest';

const { capturarLeadComprador } = vi.hoisted(() => ({
  capturarLeadComprador: vi.fn(),
}));

vi.mock('@/lib/services/realizacao', () => ({ capturarLeadComprador }));

import { POST } from '@/app/api/comprar/lead/route';

function req(body: object): Request {
  return new Request('http://x/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE = {
  nome: 'Maria',
  email: 'maria@example.com',
  consentimentoLgpd: true,
};

beforeEach(() => {
  capturarLeadComprador.mockReset().mockResolvedValue({
    leadId: 'l_1',
    payloadHash: 'hash',
    txHash: 'tx',
  });
});

describe('POST /api/comprar/lead', () => {
  it('200 PF válido', async () => {
    const r = await POST(req({ ...BASE, tipo: 'PESSOA_FISICA' }));
    expect(r.status).toBe(200);
    expect(capturarLeadComprador.mock.calls[0][0].tipo).toBe('PESSOA_FISICA');
  });

  it('200 PJ válido', async () => {
    const r = await POST(req({ ...BASE, tipo: 'PESSOA_JURIDICA' }));
    expect(r.status).toBe(200);
    expect(capturarLeadComprador.mock.calls[0][0].tipo).toBe('PESSOA_JURIDICA');
  });

  it('200 ausente → default PF', async () => {
    const r = await POST(req(BASE));
    expect(r.status).toBe(200);
    expect(capturarLeadComprador.mock.calls[0][0].tipo).toBe('PESSOA_FISICA');
  });

  it('400 string inválida em vez de fallback silencioso', async () => {
    const r = await POST(req({ ...BASE, tipo: 'PJ' }));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toMatch(/inválido/);
    // C-06: Zod issues detalham o campo divergente.
    expect(json.issues?.[0]?.path).toBe('tipo');
    expect(capturarLeadComprador).not.toHaveBeenCalled();
  });

  it('400 sem consentimento LGPD', async () => {
    const r = await POST(
      req({ nome: 'X', email: 'x@x.com', consentimentoLgpd: false }),
    );
    expect(r.status).toBe(400);
  });
});
