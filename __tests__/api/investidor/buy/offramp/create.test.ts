/** off-ramp/create: erro do anchor vira 422/502 com mensagem fixa (Vera, E2); o mock de sandbox para conta ausente segue. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AnchorError } from '@/lib/anchors/types';

const m = vi.hoisted(() => ({ quoteFindUnique: vi.fn(), offCreate: vi.fn(), audit: vi.fn(), createOffRamp: vi.fn(), getFiatAccounts: vi.fn(), registerCustomerWallet: vi.fn() }));
vi.mock('@/lib/wallet/auth-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/wallet/auth-guard')>()),
  requireInvestidor: vi.fn().mockResolvedValue({ privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GABC', email: 'x@y.z', etherfuseCustomerId: 'cust_1' }),
}));
vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: m.quoteFindUnique },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ offRampOrder: { create: m.offCreate }, eventoAudit: { create: m.audit } }),
  },
}));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class { createOffRamp = m.createOffRamp; getFiatAccounts = m.getFiatAccounts; registerCustomerWallet = m.registerCustomerWallet; } }));
process.env.ETHERFUSE_API_KEY = 'test';
process.env.ETHERFUSE_ENV = 'sandbox';

import { POST } from '@/app/api/investidor/buy/offramp/create/route';

const req = () => new Request('http://x/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: 'q_1' }) });
const quote = () => ({
  id: 'q_1', investidorId: 'inv_1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000), fromCurrency: 'TESOURO', toCurrency: 'BRL',
  fromAmount: new Prisma.Decimal('100'), offRampOrder: null,
  investidor: { etherfuseCustomerId: 'cust_1', etherfuseBankAccountId: 'bank_1', publicKey: 'GABC' },
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.quoteFindUnique.mockReset().mockResolvedValue(quote());
  m.offCreate.mockReset().mockResolvedValue({});
  m.audit.mockReset().mockResolvedValue({});
  m.createOffRamp.mockReset();
  m.getFiatAccounts.mockReset();
  m.registerCustomerWallet.mockReset().mockResolvedValue({ walletId: 'wallet-1' });
});

describe('POST /api/investidor/buy/offramp/create — erros do anchor', () => {
  it('anchor 4xx → 422 VALIDATION_FAILED fixo (não 500); nada persistido; texto do upstream não vaza', async () => {
    m.createOffRamp.mockRejectedValue(new AnchorError('Terms and conditions have not been completed ana@exemplo.test', 'UNKNOWN_ERROR', 400));
    const r = await POST(req());
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(j)).not.toMatch(/Terms and conditions|exemplo\.test/);
    expect(m.offCreate).not.toHaveBeenCalled();
  });
  it('anchor 5xx → 502 ETHERFUSE_ERROR fixo; erro que não é do anchor segue 500', async () => {
    m.createOffRamp.mockRejectedValueOnce(new AnchorError('caiu xyz', 'UNKNOWN_ERROR', 503));
    const r = await POST(req());
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe('ETHERFUSE_ERROR');
    m.createOffRamp.mockRejectedValueOnce(new Error('banco'));
    expect((await POST(req())).status).toBe(500);
  });
  it('conta bancária ausente em sandbox continua indo para o mock (200)', async () => {
    m.createOffRamp.mockRejectedValue(new AnchorError('proxy account not found', 'X', 400));
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect((await r.json()).data.mock).toBe(true);
  });
  it('registra a carteira no customer e manda o walletId como cryptoWalletId; sem registro, a ordem não sai', async () => {
    m.createOffRamp.mockResolvedValueOnce({ id: 'off_1', status: 'pending' });
    expect((await POST(req())).status).toBe(200);
    expect(m.registerCustomerWallet).toHaveBeenCalledWith('cust_1', 'GABC');
    expect(m.createOffRamp.mock.calls[0][0]).toMatchObject({ cryptoWalletId: 'wallet-1', fiatAccountId: 'bank_1' });
    m.registerCustomerWallet.mockRejectedValueOnce(new AnchorError('x', 'NOT_FOUND', 404));
    m.createOffRamp.mockClear();
    expect((await POST(req())).status).toBe(422);
    expect(m.createOffRamp).not.toHaveBeenCalled();
  });
});
