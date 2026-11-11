import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';

const USER_PK = Keypair.random().publicKey();
const { quoteCreate, getQuote, calcularPrecoDeEmissao } = vi.hoisted(() => ({
  quoteCreate: vi.fn(),
  getQuote: vi.fn(),
  calcularPrecoDeEmissao: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, {
        user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: USER_PK, email: 'x@y.z', etherfuseCustomerId: 'cust_1' },
      }),
}));
const quoteFindFirst = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { resgateCotacao: { findFirst: async () => null }, quote: { create: quoteCreate, findFirst: quoteFindFirst } } }));
vi.mock('@/lib/services/emissao', () => ({ calcularPrecoDeEmissao }));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class { getQuote = getQuote; } }));
process.env.ETHERFUSE_API_KEY = 'test';

import { POST } from '@/app/api/investidor/quote/route';
import { NAV_INDISPONIVEL_MENSAGEM, NavIndisponivelError } from '@/lib/services/nav-supply';
import { sensitiveAuthLimiter } from '@/lib/rate-limit/config';

const req = (body: object) =>
  new Request('http://x/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const onramp = { amountBrl: '400', customerId: 'cust_1', stellarAddress: USER_PK };

beforeEach(async () => {
  await sensitiveAuthLimiter.reset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  quoteCreate.mockReset().mockResolvedValue({});
  quoteFindFirst.mockReset().mockResolvedValue(null);
  getQuote.mockReset().mockResolvedValue({
    id: 'q_1', fromCurrency: 'BRL', fromAmount: '400', toCurrency: 'TESOURO', toAmount: '342.16',
    exchangeRate: '0.8554', fee: '0', expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
  });
  calcularPrecoDeEmissao.mockReset().mockResolvedValue({
    navPorTokenNaCotacao: new Prisma.Decimal('1.0625'),
    plinarfAmount: new Prisma.Decimal('376.4705882'),
  });
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/investidor/quote — preço de emissão ao NAV', () => {
  it('BRL vem de fromAmount; persiste NAV congelado e plinarfAmount separado de toAmount', async () => {
    const r = await POST(req(onramp));
    expect(r.status).toBe(200);
    expect(calcularPrecoDeEmissao.mock.calls[0][0].valorBrl.toFixed(2)).toBe('400.00');
    const data = quoteCreate.mock.calls[0][0].data;
    expect(data.navPorTokenNaCotacao.toFixed(8)).toBe('1.06250000');
    expect(data.plinarfAmount.toFixed(7)).toBe('376.4705882');
    expect(data.toAmount.toFixed(2)).toBe('342.16');
    const json = await r.json();
    expect(json.plinarfAmount).toBe('376.4705882');
    expect(json.navPorTokenNaCotacao).toBe('1.06250000');
  });

  it('N1: o preço (q) usa o valor LÍQUIDO do fee — BRL 400 com fee 50 → calcularPrecoDeEmissao recebe 350', async () => {
    getQuote.mockResolvedValueOnce({
      id: 'q_3', fromCurrency: 'BRL', fromAmount: '400', toCurrency: 'TESOURO', toAmount: '299.4',
      exchangeRate: '0.8554', fee: '50', expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
    });
    const r = await POST(req(onramp));
    expect(r.status).toBe(200);
    expect(calcularPrecoDeEmissao.mock.calls[0][0].valorBrl.toFixed(2)).toBe('350.00');
    expect(quoteCreate.mock.calls[0][0].data.fromAmount.toFixed(2)).toBe('400.00'); // o quote guarda o bruto pago
  });

  it('N1: classe SUBORDINADA é recusada (422 CLASSE_INDISPONIVEL) antes de chamar a Etherfuse e sem persistir', async () => {
    const r = await POST(req({ ...onramp, classe: 'SUBORDINADA' }));
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe('CLASSE_INDISPONIVEL');
    expect(getQuote).not.toHaveBeenCalled();
    expect(calcularPrecoDeEmissao).not.toHaveBeenCalled();
    expect(quoteCreate).not.toHaveBeenCalled();
  });

  it('swap em conferência: o investidor com reserva órfã não cria cotação nova (409), sem chamar a Etherfuse', async () => {
    quoteFindFirst.mockResolvedValueOnce({ id: 'q_orfa' });
    const r = await POST(req(onramp));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('SWAP_EM_CONFERENCIA');
    expect(quoteFindFirst.mock.calls[0][0].where).toMatchObject({ investidorId: 'inv_1', consumedAt: null });
    expect(getQuote).not.toHaveBeenCalled();
    expect(quoteCreate).not.toHaveBeenCalled();
  });

  it('N1: classe SENIOR explícita segue normal', async () => {
    const r = await POST(req({ ...onramp, classe: 'SENIOR' }));
    expect(r.status).toBe(200);
    expect(quoteCreate.mock.calls[0][0].data.classe).toBe('SENIOR');
  });

  it('off-ramp não calcula preço de emissão', async () => {
    getQuote.mockResolvedValueOnce({
      id: 'q_2', fromCurrency: 'TESOURO', fromAmount: '10', toCurrency: 'BRL', toAmount: '11',
      exchangeRate: '1.1', fee: '0', expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
    });
    const r = await POST(req({ amountTesouro: '10', direction: 'offramp', customerId: 'cust_1', stellarAddress: USER_PK }));
    expect(r.status).toBe(200);
    expect(calcularPrecoDeEmissao).not.toHaveBeenCalled();
    expect(quoteCreate.mock.calls[0][0].data.plinarfAmount).toBeNull();
  });

  it('NAV indisponível (ledger fora / PLINARFB): 503 constante e NADA é persistido', async () => {
    calcularPrecoDeEmissao.mockRejectedValue(new NavIndisponivelError('SUBORDINADA_CIRCULANDO'));
    const r = await POST(req(onramp));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: NAV_INDISPONIVEL_MENSAGEM, code: 'LEDGER_UNAVAILABLE' });
    expect(quoteCreate).not.toHaveBeenCalled();
  });

  it('L1-S4: sensitiveAuthLimiter — acima de 10/min por IP → 429, sem chamar a Etherfuse', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await POST(req(onramp))).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    expect(getQuote).toHaveBeenCalledTimes(10);
  });

  it('L1-S5: erro inesperado → 500 fixo, sem err.message no corpo (a causa vai ao log)', async () => {
    getQuote.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432 DATABASE_URL=postgres://u:p@h/db'));
    const r = await POST(req(onramp));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body).toEqual({ error: 'erro interno' });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|DATABASE_URL|postgres/);
  });
});
