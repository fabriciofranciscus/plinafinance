import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { AnchorError } from '@/lib/anchors/types';

const { quoteFindUnique, onRampCreate, eventoAuditCreate, createOnRamp, registerCustomerWallet } =
  vi.hoisted(() => ({
    registerCustomerWallet: vi.fn(),
    quoteFindUnique: vi.fn(),
    onRampCreate: vi.fn(),
    eventoAuditCreate: vi.fn(),
    createOnRamp: vi.fn(),
  }));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return {
    ...actual, // mantém AuthError real (withApi precisa dele)
    requireInvestidor: vi.fn().mockResolvedValue({
      privyId: 'did:privy:abc',
      investidorId: 'inv_1',
      publicKey: 'GABC',
      email: 'x@y.z',
      etherfuseCustomerId: 'cust_1',
    }),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: quoteFindUnique },
    $transaction: async (
      cb: (tx: {
        onRampOrder: { create: typeof onRampCreate };
        eventoAudit: { create: typeof eventoAuditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        onRampOrder: { create: onRampCreate },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    createOnRamp = createOnRamp;
    registerCustomerWallet = registerCustomerWallet;
  },
}));

process.env.ETHERFUSE_API_KEY = 'test';
process.env.ETHERFUSE_ENV = 'sandbox';

import { POST } from '@/app/api/investidor/buy/onramp/create/route';

function req(body: object): Request {
  return new Request('http://x/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    fromCurrency: 'BRL',
    toCurrency: 'TESOURO',
    fromAmount: new Prisma.Decimal('100'),
    investidor: {
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: 'bank_1',
      publicKey: 'GABC',
    },
    onRampOrder: null,
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  onRampCreate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  createOnRamp.mockReset();
  registerCustomerWallet.mockReset().mockResolvedValue({ walletId: 'wallet-1' });
});

describe('POST /api/investidor/buy/onramp/create', () => {
  it('400 sem quoteId', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(403);
  });

  it('200 idempotente devolve order existente', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        onRampOrder: {
          id: 'ord_existing',
          status: 'pending',
          paymentInstructionsJson: { __mock: true },
        },
      }),
    );
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.orderId).toBe('ord_existing');
    expect(onRampCreate).not.toHaveBeenCalled();
  });

  it('200 happy path mock cria order com user.investidorId', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(
      new AnchorError('proxy account not found', 'BANK_ACCOUNT_MISSING'),
    );
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.mock).toBe(true);
    expect(onRampCreate).toHaveBeenCalledOnce();
    expect(onRampCreate.mock.calls[0][0].data.investidorId).toBe('inv_1');
    // a conta Pix salva do investidor vai ao anchor (não a "1ª conta da lista")
    expect(createOnRamp.mock.calls[0][0]).toMatchObject({ customerId: 'cust_1', bankAccountId: 'bank_1', cryptoWalletId: 'wallet-1' });
    expect(registerCustomerWallet).toHaveBeenCalledWith('cust_1', 'GABC');
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });

  it('Vera E2: anchor 400 "Terms and conditions have not been completed" → 422 VALIDATION_FAILED com mensagem FIXA (antes 500 INTERNAL); nada persistido; o texto do upstream não vaza', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(
      new AnchorError('Terms and conditions have not been completed for the selected wallet GABC de ana@exemplo.test', 'UNKNOWN_ERROR', 400),
    );
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(j)).not.toMatch(/Terms and conditions|GABC|exemplo\.test/);
    expect(j.error.message).toMatch(/Complete o seu cadastro/);
    expect(onRampCreate).not.toHaveBeenCalled();
  });

  it('anchor 5xx/rede → 502 ETHERFUSE_ERROR com mensagem fixa; erro que não é do anchor segue 500 INTERNAL', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(new AnchorError('upstream caiu com segredo xyz', 'UNKNOWN_ERROR', 503));
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.error.code).toBe('ETHERFUSE_ERROR');
    expect(JSON.stringify(j)).not.toContain('xyz');
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(new Error('falha de banco'));
    expect((await POST(req({ quoteId: 'q_1' }))).status).toBe(500);
  });

  it('o mock de sandbox para conta bancária ausente continua funcionando (4xx de "bank account" não vira 422)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    createOnRamp.mockRejectedValueOnce(new AnchorError('Bank account not found', 'X', 400));
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(200);
    expect((await r.json()).data.mock).toBe(true);
  });

  it('fail-closed: se o registro da carteira falhar (4xx do anchor), a ordem NÃO sai: 422 fixo e createOnRamp não é chamado', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    registerCustomerWallet.mockRejectedValueOnce(new AnchorError('wallet de ana@exemplo.test não encontrada', 'NOT_FOUND', 404));
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).not.toContain('exemplo.test');
    expect(createOnRamp).not.toHaveBeenCalled();
    expect(onRampCreate).not.toHaveBeenCalled();
  });
});
