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
    // Chamada direta (fora de transação) pro evento KYC_DOCUMENTOS_ENVIADOS.
    eventoAudit: { create: eventoAuditCreate },
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
  delete process.env.ETHERFUSE_ENV; // default 'sandbox' (etherfuseEnv() fail-open)
});

const DOCUMENTOS_FAKE = {
  idFront: 'data:image/jpeg;base64,front',
  idBack: 'data:image/jpeg;base64,back',
  selfie: 'data:image/jpeg;base64,selfie',
};

function mockFluxoCompleto() {
  ensureStellarWallet.mockResolvedValueOnce('GNEW');
  fundAccountIfNeeded.mockResolvedValueOnce({ funded: false });
  createCustomer.mockResolvedValueOnce({ id: 'cust_new', bankAccountId: 'stub' });
  submitKycIdentity.mockResolvedValueOnce(undefined);
  submitKycDocuments.mockResolvedValue(undefined);
  getKycUrl.mockResolvedValueOnce('https://kyc.url');
  acceptElectronicSignature.mockResolvedValueOnce(undefined);
  acceptTermsAndConditions.mockResolvedValueOnce(undefined);
  getKycStatus.mockResolvedValueOnce('approved');
  pessoaUpsert.mockResolvedValueOnce({ id: 'pes_new', papeis: ['CEDENTE'] });
}

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

  it('já aprovado + registro de banco falhando = best-effort (não lança 500)', async () => {
    pessoaFindUnique.mockResolvedValueOnce({
      id: 'pes_1',
      privyId: 'did:privy:abc',
      kycAprovado: true,
      kycStatus: 'APROVADO',
      publicKey: 'GABC',
      etherfuseCustomerId: 'cust_1',
      etherfuseBankAccountId: null, // ainda sem banco → tenta registrar
      cpfNormalizado: '52998224725',
      isSyntheticCpf: false,
      papeis: ['INVESTIDOR'],
      nome: 'Maria',
    });
    // registerPixForPessoa chama getKycUrl primeiro — fazemos falhar.
    getKycUrl.mockRejectedValueOnce(new Error('etherfuse 503'));
    pessoaUpdate.mockImplementation(
      async ({ data }: { data: { papeis: { set: string[] } } }) => ({
        id: 'pes_1',
        publicKey: 'GABC',
        etherfuseCustomerId: 'cust_1',
        etherfuseBankAccountId: null,
        kycStatus: 'APROVADO',
        kycAprovado: true,
        cpfNormalizado: '52998224725',
        isSyntheticCpf: false,
        papeis: data.papeis.set,
      }),
    );

    const result = await ensureKycForPessoa({
      privyId: 'did:privy:abc',
      email: 'maria@x.com',
      papel: 'CEDENTE' as never,
      bankAccount: {
        pixKey: 'maria@x.com',
        pixKeyType: 'email',
        firstName: 'Maria',
        lastName: 'Silva',
        cpf: '52998224725',
      },
    });

    // Não lançou; KYC segue aprovado mesmo com o banco falhando.
    expect(result.kycAprovado).toBe(true);
    expect(result.papeis).toContain('CEDENTE');
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

    // Etherfuse (2026-07-01): email/phoneNumber/occupation viraram
    // obrigatórios no customer-agreement, e idNumbers só é aceito para MX
    // (CPF em address.country=BR agora 400a). Trava o payload correto.
    const identityArg = submitKycIdentity.mock.calls[0][1];
    expect(identityArg.identity.email).toBe('novo@x.com');
    expect(identityArg.identity.phoneNumber).toBeTruthy();
    expect(identityArg.identity.occupation).toBeTruthy();
    expect(identityArg.identity.idNumbers).toBeUndefined();
    expect(result.pessoaId).toBe('pes_new');
    expect(result.publicKey).toBe('GNEW');
  });
});

describe('ensureKycForPessoa — campos opcionais Etherfuse (sandbox vs. produção)', () => {
  it('sandbox: omite os campos extras do payload mesmo quando fornecidos', async () => {
    pessoaFindUnique.mockResolvedValueOnce(null);
    mockFluxoCompleto();

    await ensureKycForPessoa({
      privyId: 'did:privy:new',
      email: 'novo@x.com',
      nome: 'Novo Cedente',
      papel: 'CEDENTE' as never,
      middleName: 'Souza',
      motherMaidenName: 'Pereira',
      preferredName: 'Nô',
      useEmailForMarketing: true,
      endereco: { rua: 'Rua X', cidade: 'SP', estado: 'SP', cep: '01000-000', street2: 'Apto 1' },
    });

    const identityArg = submitKycIdentity.mock.calls[0][1];
    expect(identityArg.identity.name.middleName).toBeUndefined();
    expect(identityArg.identity.name.motherMaidenName).toBeUndefined();
    expect(identityArg.identity.name.preferredName).toBeUndefined();
    expect(identityArg.identity.address.street2).toBeUndefined();
    expect(identityArg.identity.useEmailForMarketing).toBeUndefined();
    expect('useEmailForMarketing' in identityArg.identity).toBe(false);
  });

  it('produção: inclui os campos extras quando fornecidos', async () => {
    process.env.ETHERFUSE_ENV = 'production';
    pessoaFindUnique.mockResolvedValueOnce(null);
    mockFluxoCompleto();

    await ensureKycForPessoa({
      privyId: 'did:privy:new',
      email: 'novo@x.com',
      nome: 'Novo Cedente',
      papel: 'CEDENTE' as never,
      cpf: '52998224725', // ETHERFUSE_ENV=production exige CPF real (módulo 11)
      middleName: 'Souza',
      motherMaidenName: 'Pereira',
      preferredName: 'Nô',
      useEmailForMarketing: true,
      endereco: { rua: 'Rua X', cidade: 'SP', estado: 'SP', cep: '01000-000', street2: 'Apto 1' },
      documentos: DOCUMENTOS_FAKE,
    });

    const identityArg = submitKycIdentity.mock.calls[0][1];
    expect(identityArg.identity.name.middleName).toBe('Souza');
    expect(identityArg.identity.name.motherMaidenName).toBe('Pereira');
    expect(identityArg.identity.name.preferredName).toBe('Nô');
    expect(identityArg.identity.address.street2).toBe('Apto 1');
    expect(identityArg.identity.useEmailForMarketing).toBe(true);
  });

  it('produção: sem documentos rejeita antes de chamar a Etherfuse (400)', async () => {
    process.env.ETHERFUSE_ENV = 'production';
    pessoaFindUnique.mockResolvedValueOnce(null);

    await expect(
      ensureKycForPessoa({
        privyId: 'did:privy:new',
        email: 'novo@x.com',
        nome: 'Novo Cedente',
        papel: 'CEDENTE' as never,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(submitKycIdentity).not.toHaveBeenCalled();
    expect(submitKycDocuments).not.toHaveBeenCalled();
  });

  it('sandbox: sem documentos ainda usa o fallback dummy (comportamento preservado)', async () => {
    pessoaFindUnique.mockResolvedValueOnce(null);
    mockFluxoCompleto();

    await ensureKycForPessoa({
      privyId: 'did:privy:new',
      email: 'novo@x.com',
      nome: 'Novo Cedente',
      papel: 'CEDENTE' as never,
    });

    const docCall = submitKycDocuments.mock.calls[0][1];
    expect(docCall.images[0].image).toMatch(/^data:image\/png;base64,/);
  });

  it('não reenvia documentos se já foram enviados antes (kycDocumentosEnviadosEm setado)', async () => {
    pessoaFindUnique.mockResolvedValueOnce({
      id: 'pes_pending',
      privyId: 'did:privy:pending',
      kycAprovado: false,
      kycStatus: 'PENDENTE',
      publicKey: null,
      etherfuseCustomerId: null,
      etherfuseBankAccountId: null,
      cpfNormalizado: null,
      isSyntheticCpf: false,
      papeis: ['CEDENTE'],
      nome: 'Pendente',
      kycDocumentosEnviadosEm: new Date('2026-06-01'),
    });
    ensureStellarWallet.mockResolvedValueOnce('GPENDING');
    fundAccountIfNeeded.mockResolvedValueOnce({ funded: false });
    createCustomer.mockResolvedValueOnce({ id: 'cust_pending', bankAccountId: 'stub' });
    submitKycIdentity.mockResolvedValueOnce(undefined);
    getKycUrl.mockResolvedValueOnce('https://kyc.url');
    acceptElectronicSignature.mockResolvedValueOnce(undefined);
    acceptTermsAndConditions.mockResolvedValueOnce(undefined);
    getKycStatus.mockResolvedValueOnce('pending');
    pessoaUpsert.mockResolvedValueOnce({ id: 'pes_pending', papeis: ['CEDENTE'] });

    await ensureKycForPessoa({
      privyId: 'did:privy:pending',
      email: 'pendente@x.com',
      nome: 'Pendente',
      papel: 'CEDENTE' as never,
    });

    expect(submitKycDocuments).not.toHaveBeenCalled();
  });
});

describe('ensureKycForPessoa — CPF real exigido em KYC de produção (não só mainnet)', () => {
  it('CPF com formato errado em ETHERFUSE_ENV=production rejeita com 400, mesmo em STELLAR_NETWORK=TESTNET', async () => {
    process.env.ETHERFUSE_ENV = 'production';
    pessoaFindUnique.mockResolvedValueOnce(null);

    await expect(
      ensureKycForPessoa({
        privyId: 'did:privy:new',
        email: 'novo@x.com',
        nome: 'Novo Cedente',
        papel: 'CEDENTE' as never,
        cpf: '11111111111', // 11 dígitos, checksum inválido
        documentos: DOCUMENTOS_FAKE,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Sem isso, cairia no fallback sintético (52998224725) casado com nome
    // e documentos reais — não pode nem chegar a criar o customer.
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('CPF válido em ETHERFUSE_ENV=production passa normalmente', async () => {
    process.env.ETHERFUSE_ENV = 'production';
    pessoaFindUnique.mockResolvedValueOnce(null);
    mockFluxoCompleto();

    const result = await ensureKycForPessoa({
      privyId: 'did:privy:new',
      email: 'novo@x.com',
      nome: 'Novo Cedente',
      papel: 'CEDENTE' as never,
      cpf: '52998224725', // CPF de teste válido por módulo 11
      documentos: DOCUMENTOS_FAKE,
    });

    expect(result.cpfNormalizado).toBe('52998224725');
    expect(result.isSyntheticCpf).toBe(false);
  });
});
