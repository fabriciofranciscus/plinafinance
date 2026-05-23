import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calcularValorLiquidacao } = vi.hoisted(() => ({
  calcularValorLiquidacao: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (
    handler: (
      req: Request,
      ctx: { user: Record<string, unknown> },
    ) => Promise<Response>,
  ) =>
    (req: Request) =>
      handler(req, {
        user: {
          privyId: 'did:privy:abc',
          investidorId: 'inv_1',
          publicKey: 'GABC',
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/services/liquidacao', () => ({ calcularValorLiquidacao }));

import { POST } from '@/app/api/investidor/liquidar/quote/route';
import { sensitiveAuthLimiter } from '@/lib/rate-limit/config';

function req(body: object, ip = '10.0.0.1'): Request {
  return new Request('http://x/quote', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  calcularValorLiquidacao.mockReset().mockResolvedValue({
    brlEquivalente: 100,
    navPorTokenAtual: 1.0,
  });
  sensitiveAuthLimiter.reset();
});

describe('POST /api/investidor/liquidar/quote', () => {
  it('400 sem amountPlinarf', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('200 happy path', async () => {
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(200);
    expect(calcularValorLiquidacao).toHaveBeenCalledWith({
      amountPlinarf: '10',
    });
  });

  it('N-08: 429 após 10 chamadas do mesmo IP em 1 minuto', async () => {
    const ip = '10.0.0.99';
    for (let i = 0; i < 10; i++) {
      const ok = await POST(req({ amountPlinarf: '1' }, ip));
      expect(ok.status).toBe(200);
    }
    const r = await POST(req({ amountPlinarf: '1' }, ip));
    expect(r.status).toBe(429);
  });
});
