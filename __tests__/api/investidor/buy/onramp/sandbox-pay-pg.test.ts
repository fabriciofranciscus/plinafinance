/**
 * sandbox-pay contra o Postgres REAL: chamadas simultâneas na mesma ordem (mock) gravam UMA liquidação e UM evento ONRAMP_LIQUIDADA
 * (escrita condicional + count === 1). Só roda com um Postgres descartável em TEST_PG_URL (localhost, migrations aplicadas).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (h: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) => (req: Request) =>
    h(req, { user: { privyId: 'did:privy:t', investidorId: 'inv_t', publicKey: 'GABC', email: 'x@y.z', etherfuseCustomerId: 'cust_1' } }),
}));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class {} }));
process.env.ETHERFUSE_API_KEY = 'test';
process.env.ETHERFUSE_ENV = 'sandbox';

import { db } from '@/lib/db';
import { POST } from '@/app/api/investidor/buy/onramp/sandbox-pay/route';

const req = () => new Request('http://x/sandbox-pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: 'o1' }) });

describe.skipIf(!PG)('sandbox-pay — concorrência real no Postgres', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "EventoAudit","OnRampOrder","Quote","Investidor" RESTART IDENTITY CASCADE');
    await db.investidor.create({ data: { id: 'inv_t', nome: 'Inv', email: 'inv@exemplo.test', publicKey: 'G' + 'A'.repeat(55), privyId: 'did:privy:t' } });
    await db.quote.create({ data: { id: 'q_o1', investidorId: 'inv_t', fromCurrency: 'BRL', fromAmount: '10', toCurrency: 'TESOURO', toAmount: '8', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 60_000) } });
    await db.onRampOrder.create({ data: { id: 'o1', quoteId: 'q_o1', investidorId: 'inv_t', status: 'pending', paymentInstructionsJson: { __mock: true } } as never });
  });

  it('5 chamadas simultâneas na mesma ordem mock: todas 200, a ordem fica completed e há UM evento ONRAMP_LIQUIDADA', async () => {
    const r = await Promise.all(Array.from({ length: 5 }, () => POST(req())));
    expect(r.map((x) => x.status)).toEqual(Array(5).fill(200));
    const o = await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } });
    expect(o.status).toBe('completed');
    expect(o.settledAt).not.toBeNull();
    expect(await db.eventoAudit.count({ where: { acao: 'ONRAMP_LIQUIDADA' } })).toBe(1);
  });
});
