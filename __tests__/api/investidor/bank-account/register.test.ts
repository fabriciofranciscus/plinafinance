import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEtherfuseInstance, mockInvestidorFindUnique, mockInvestidorUpdate, mockEventoAuditCreate, mockDbTransaction } =
  vi.hoisted(() => ({
    mockEtherfuseInstance: {
      getKycUrl: vi.fn(),
      registerPixBankAccount: vi.fn(),
      getFiatAccounts: vi.fn(),
    },
    mockInvestidorFindUnique: vi.fn(),
    mockInvestidorUpdate: vi.fn(),
    mockEventoAuditCreate: vi.fn(),
    mockDbTransaction: vi.fn(),
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

vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    getKycUrl = mockEtherfuseInstance.getKycUrl;
    registerPixBankAccount = mockEtherfuseInstance.registerPixBankAccount;
    getFiatAccounts = mockEtherfuseInstance.getFiatAccounts;
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    investidor: {
      findUnique: mockInvestidorFindUnique,
      update: mockInvestidorUpdate,
    },
    eventoAudit: {
      create: mockEventoAuditCreate,
    },
    $transaction: mockDbTransaction,
  },
}));

import { POST } from '@/app/api/investidor/bank-account/register/route';

function req(body: object): Request {
  return new Request('http://x/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_BODY = {
  pixKey: '52998224725',
  pixKeyType: 'cpf',
  cpf: '52998224725',
  firstName: 'Plina',
  lastName: 'SmokeTest',
};

beforeEach(() => {
  process.env.ETHERFUSE_API_KEY = 'test-key';
  mockInvestidorFindUnique.mockReset();
  mockInvestidorUpdate.mockReset().mockResolvedValue(undefined);
  mockEventoAuditCreate.mockReset().mockResolvedValue(undefined);
  mockDbTransaction.mockReset().mockImplementation(async (fn) =>
    fn({
      investidor: { update: mockInvestidorUpdate },
      eventoAudit: { create: mockEventoAuditCreate },
    }),
  );
  mockEtherfuseInstance.getFiatAccounts.mockReset().mockResolvedValue([]);
  mockEtherfuseInstance.getKycUrl
    .mockReset()
    .mockResolvedValue('https://devnet.etherfuse.com/ramp/onboarding?...sig=...');
  mockEtherfuseInstance.registerPixBankAccount.mockReset().mockResolvedValue({
    bankAccountId: 'bank-xyz',
    customerId: 'cust_1',
    status: 'active',
    compliant: true,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  });
});

describe('POST /api/investidor/bank-account/register (PLINA-MOD-006)', () => {
  it('400 sem pixKey', async () => {
    const { pixKey: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('400 sem pixKeyType', async () => {
    const { pixKeyType: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('400 sem cpf', async () => {
    const { cpf: _, ...body } = FULL_BODY;
    void _;
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });

  it('409 quando etherfuseCustomerId é null no Investidor', async () => {
    mockInvestidorFindUnique.mockResolvedValueOnce({
      id: 'inv_1',
      publicKey: 'GABC',
      etherfuseCustomerId: null,
      etherfuseBankAccountId: null,
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
  });

  it('200 idempotente: já tem etherfuseBankAccountId — não chama Etherfuse', async () => {
    mockInvestidorFindUnique.mockResolvedValueOnce({
      id: 'inv_1',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: 'existing-bank',
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.bankAccountId).toBe('existing-bank');
    expect(json.data.idempotent).toBe(true);
    expect(mockEtherfuseInstance.registerPixBankAccount).not.toHaveBeenCalled();
  });

  it('200 reuso: conta PIX já existe na Etherfuse — reaproveita sem registrar', async () => {
    mockInvestidorFindUnique.mockResolvedValueOnce({
      id: 'inv_1',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: null,
    });
    mockEtherfuseInstance.getFiatAccounts.mockResolvedValueOnce([
      { id: 'bank-existente', type: 'PIX', accountNumber: '529***', bankName: 'x', accountHolderName: 'y', createdAt: '' },
    ]);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.bankAccountId).toBe('bank-existente');
    expect(json.data.idempotent).toBe(true);
    expect(mockEtherfuseInstance.registerPixBankAccount).not.toHaveBeenCalled();
    expect(mockInvestidorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ etherfuseBankAccountId: 'bank-existente' }),
      }),
    );
  });

  it('200 happy path: registra na Etherfuse, persiste no DB, audita', async () => {
    mockInvestidorFindUnique.mockResolvedValueOnce({
      id: 'inv_1',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: null,
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.bankAccountId).toBe('bank-xyz');
    expect(json.data.status).toBe('active');
    expect(mockEtherfuseInstance.getKycUrl).toHaveBeenCalledOnce();
    expect(mockEtherfuseInstance.registerPixBankAccount).toHaveBeenCalledOnce();
    // Body do registerPixBankAccount chega com os 5 campos PIX (transactionId é injetado dentro do client).
    expect(mockEtherfuseInstance.registerPixBankAccount.mock.calls[0][1]).toMatchObject({
      pixKey: FULL_BODY.pixKey,
      pixKeyType: FULL_BODY.pixKeyType,
      cpf: FULL_BODY.cpf,
      firstName: FULL_BODY.firstName,
      lastName: FULL_BODY.lastName,
    });
    expect(mockInvestidorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv_1' },
        data: expect.objectContaining({ etherfuseBankAccountId: 'bank-xyz' }),
      }),
    );
    expect(mockEventoAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acao: 'BANK_ACCOUNT_REGISTRADA',
          investidorId: 'inv_1',
          privyId: 'did:privy:abc',
        }),
      }),
    );
  });
});
