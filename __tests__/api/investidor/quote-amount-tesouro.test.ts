import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();

const { quoteCreate, getQuote } = vi.hoisted(() => ({
  quoteCreate: vi.fn(),
  getQuote: vi.fn(),
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
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: { quote: { create: quoteCreate, findFirst: async () => null }, resgateCotacao: { findFirst: async () => null } },
}));

vi.mock('@/lib/services/emissao', async () => {
  const { Prisma } = await import('@prisma/client');
  return {
    calcularPrecoDeEmissao: vi.fn().mockResolvedValue({
      navPorTokenNaCotacao: new Prisma.Decimal('1'),
      plinarfAmount: new Prisma.Decimal('100'),
    }),
  };
});

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    getQuote = getQuote;
  },
}));

vi.mock('@/lib/rate-limit/config', () => ({ sensitiveAuthLimiter: { consume: async () => true }, clientIp: () => 'ip' }));

process.env.ETHERFUSE_API_KEY = 'test';

import { POST } from '@/app/api/investidor/quote/route';

function req(body: object): Request {
  return new Request('http://x/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const off = (amountTesouro: unknown) => ({ direction: 'offramp', amountTesouro, customerId: 'cust_1', stellarAddress: USER_PK });

beforeEach(() => {
  quoteCreate.mockReset().mockResolvedValue({});
  getQuote.mockReset().mockResolvedValue({
    id: 'q_1', fromCurrency: 'TESOURO', fromAmount: '8.5', toCurrency: 'BRL', toAmount: '8.4', exchangeRate: '1', fee: '0.1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
  });
});

/** I3 item 2: amountTesouro do offramp era `Number(...)` (aceitava "1e3", "0x10", " 5 "; toFixed(7) de ≥1e21 saía exponencial). Agora o limite do ativo Stellar. */
describe('POST /api/investidor/quote — amountTesouro (offramp)', () => {
  it.each(['1e3', '1e-3', '0x10', ' 5 ', '5 ', '1,5', '-1', '0', '0.0000000', '0.00000001', '1234567890123', 'abc', 'Infinity', '1e21'])('recusa %j com 400 e sem consultar o anchor', async (v) => {
    const r = await POST(req(off(v)));
    expect(r.status).toBe(400);
    expect(getQuote).not.toHaveBeenCalled();
  });
  it.each(['8.55', '1', '0.0000001', '999999999999.9999999'])('aceita %s (passa da validação de formato)', async (v) => {
    const r = await POST(req(off(v)));
    expect(r.status).not.toBe(400);
  });
});
