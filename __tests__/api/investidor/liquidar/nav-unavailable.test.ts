import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { calcularValorLiquidacao, submeterResgate } = vi.hoisted(() => ({
  calcularValorLiquidacao: vi.fn(),
  submeterResgate: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, {
        user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GBN3EFNQLKN54LI3A4PYWOCXEK6ESTWFQNMOQDSY6EXIJYCPRKRBJOIF', email: 'x@y.z' },
      }),
}));
vi.mock('@/lib/services/liquidacao', () => ({ calcularValorLiquidacao }));
vi.mock('@/lib/services/resgate', () => ({ submeterResgate }));

import { POST as quote } from '@/app/api/investidor/liquidar/quote/route';
import { POST as submit } from '@/app/api/investidor/liquidar/submit/route';
import { NAV_INDISPONIVEL_MENSAGEM, NavIndisponivelError } from '@/lib/services/nav-supply';
import { sensitiveAuthLimiter } from '@/lib/rate-limit/config';

function post(body: object): Request {
  return new Request('http://x/liquidar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.2.2.2' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  calcularValorLiquidacao.mockReset();
  submeterResgate.mockReset();
  await sensitiveAuthLimiter.reset();
});
afterEach(() => vi.restoreAllMocks());

describe('liquidar/quote — NAV indisponível', () => {
  it.each(['LEDGER_LEITURA_FALHOU', 'SUBORDINADA_CIRCULANDO', 'NAV_NAO_POSITIVO'] as const)(
    '503 constante para %s, sem err.message',
    async (motivo) => {
      calcularValorLiquidacao.mockRejectedValue(new NavIndisponivelError(motivo, { cause: new Error('ENOTFOUND horizon') }));
      const r = await quote(post({ amountPlinarf: '10' }));
      expect(r.status).toBe(503);
      const body = await r.json();
      expect(body).toEqual({ error: NAV_INDISPONIVEL_MENSAGEM, code: 'LEDGER_UNAVAILABLE' });
      expect(JSON.stringify(body)).not.toMatch(/ENOTFOUND|PLINARFB|subordinada/i);
    },
  );

  it('L1-S5: erro comum → 500 fixo, sem err.message no corpo', async () => {
    calcularValorLiquidacao.mockRejectedValue(new Error('prisma: relation "Cota" does not exist (DATABASE_URL=…)'));
    const r = await quote(post({ amountPlinarf: '10' }));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body).toEqual({ error: 'erro interno' });
    expect(JSON.stringify(body)).not.toMatch(/prisma|Cota|DATABASE_URL/);
  });
});

describe('liquidar/submit — NAV indisponível', () => {
  it('503 constante quando o NAV falha fechado, sem err.message', async () => {
    submeterResgate.mockRejectedValue(new NavIndisponivelError('SUBORDINADA_CIRCULANDO', { cause: new Error('ENOTFOUND horizon') }));
    const r = await submit(
      post({ quoteId: 'q_1', signedXdr: 'AAAA'.repeat(30) }),
    );
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toEqual({ error: NAV_INDISPONIVEL_MENSAGEM, code: 'LEDGER_UNAVAILABLE' });
    expect(JSON.stringify(body)).not.toMatch(/ENOTFOUND|PLINARFB|subordinada/i);
    expect(submeterResgate).toHaveBeenCalledTimes(1);
  });

  it('L1-S5: erro comum → 500 fixo, sem err.message no corpo', async () => {
    submeterResgate.mockRejectedValue(new Error('horizon timeout GAAAA…SECRET'));
    const r = await submit(post({ quoteId: 'q_1', signedXdr: 'AAAA'.repeat(30) }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
});
