import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  pessoaFindUnique,
  pessoaUpdate,
  pessoaUpsert,
  eventoAuditCreate,
  ensureStellarWallet,
  fundAccountIfNeeded,
  createCustomer,
  submitKycIdentity,
  submitKycDocuments,
  getKycUrl,
  getKycStatus,
  acceptElectronicSignature,
  acceptTermsAndConditions,
  EtherfuseCtor,
} = vi.hoisted(() => ({
  pessoaFindUnique: vi.fn(),
  pessoaUpdate: vi.fn(),
  pessoaUpsert: vi.fn(),
  eventoAuditCreate: vi.fn(),
  ensureStellarWallet: vi.fn(),
  fundAccountIfNeeded: vi.fn(),
  createCustomer: vi.fn(),
  submitKycIdentity: vi.fn(),
  submitKycDocuments: vi.fn(),
  getKycUrl: vi.fn(),
  getKycStatus: vi.fn(),
  acceptElectronicSignature: vi.fn(),
  acceptTermsAndConditions: vi.fn(),
  EtherfuseCtor: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    pessoa: { findUnique: pessoaFindUnique },
    $transaction: async (
      cb: (tx: Record<string, unknown>) => Promise<unknown>,
    ) =>
      cb({
        pessoa: { update: pessoaUpdate, upsert: pessoaUpsert },
        eventoAudit: { create: eventoAuditCreate },
      }),
  },
}));

vi.mock('@/lib/wallet/privy', () => ({ ensureStellarWallet }));
vi.mock('@/lib/stellar/account', () => ({ fundAccountIfNeeded }));
vi.mock('@/lib/stellar/log-error', () => ({ logStellarError: vi.fn() }));
vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: EtherfuseCtor.mockImplementation(function () {
    return {
      createCustomer,
      submitKycIdentity,
      submitKycDocuments,
      getKycUrl,
      getKycStatus,
      acceptElectronicSignature,
      acceptTermsAndConditions,
    };
  }),
}));

import { ensureKycForPessoa } from '@/lib/services/pessoa';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ETHERFUSE_API_KEY = 'test-key';
});

describe('ensureKycForPessoa — KYC uma vez entre papéis', () => {
  it('reusa KYC aprovado de investidor sem chamar Etherfuse, adicionando papel CEDENTE', async () => {
    pessoaFindUnique.mockResolvedValueOnce({
      id: 'pes_1',
      privyId: 'did:privy:abc',
      kycAprovado: true,
      kycStatus: 'APROVADO',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: 'bank_1',
      cpfNormalizado: '52998224725',
      isSyntheticCpf: false,
      papeis: ['INVESTIDOR'],
      nome: 'Maria',
    });
    pessoaUpdate.mockImplementation(async ({ data }: { data: { papeis: { set: string[] } } }) => ({
      id: 'pes_1',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: 'bank_1',
      kycStatus: 'APROVADO',
      kycAprovado: true,
      cpfNormalizado: '52998224725',
      isSyntheticCpf: false,
      papeis: data.papeis.set,
    }));

    const result = await ensureKycForPessoa({
      privyId: 'did:privy:abc',
      email: 'maria@x.com',
      papel: 'CEDENTE' as never,
    });

    // Não tocou no Etherfuse nem provisionou wallet.
    expect(EtherfuseCtor).not.toHaveBeenCalled();
    expect(ensureStellarWallet).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();

    expect(result.kycAprovado).toBe(true);
    expect(result.papeis).toContain('CEDENTE');
    expect(result.papeis).toContain('INVESTIDOR');
  });

  it('roda Etherfuse completo quando a pessoa não existe', async () => {
    pessoaFindUnique.mockResolvedValueOnce(null);
    ensureStellarWallet.mockResolvedValueOnce('GNEW');
    fundAccountIfNeeded.mockResolvedValueOnce({ funded: false });
    createCustomer.mockResolvedValueOnce({ id: 'cust_new', bankAccountId: 'stub' });
    submitKycIdentity.mockResolvedValueOnce(undefined);
    submitKycDocuments.mockResolvedValue(undefined);
    getKycUrl.mockResolvedValueOnce('https://kyc.url');
    acceptElectronicSignature.mockResolvedValueOnce(undefined);
    acceptTermsAndConditions.mockResolvedValueOnce(undefined);
    getKycStatus.mockResolvedValueOnce('approved');
    pessoaUpsert.mockResolvedValueOnce({
      id: 'pes_new',
      papeis: ['CEDENTE'],
    });

    const result = await ensureKycForPessoa({
      privyId: 'did:privy:new',
      email: 'novo@x.com',
      nome: 'Novo Cedente',
      papel: 'CEDENTE' as never,
    });

    expect(ensureStellarWallet).toHaveBeenCalledWith('did:privy:new');
    expect(createCustomer).toHaveBeenCalledOnce();
    expect(getKycStatus).toHaveBeenCalledOnce();
    expect(result.kycAprovado).toBe(true);
    expect(result.pessoaId).toBe('pes_new');
    expect(result.publicKey).toBe('GNEW');
  });
});
