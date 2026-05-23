import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Snapshot env pra restore — vários testes mexem em STELLAR_NETWORK
// & funder envs.
const ORIG = {
  network: process.env.STELLAR_NETWORK,
  secret: process.env.STELLAR_FUNDER_SECRET,
  pub: process.env.STELLAR_FUNDER_PUBLIC,
  cap: process.env.FUNDER_DAILY_CAP,
  floor: process.env.FUNDER_BALANCE_FLOOR,
};

// Keypair determinístico pro teste — secret + public batem.
import { Account, Keypair } from '@stellar/stellar-sdk';
const FUNDER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const FUNDER_SECRET = FUNDER_KP.secret();
const FUNDER_PUBLIC = FUNDER_KP.publicKey();
const DEST_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
const DEST_PUBLIC = DEST_KP.publicKey();

const eventoAuditCount = vi.fn();
const eventoAuditCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    eventoAudit: { count: eventoAuditCount, create: eventoAuditCreate },
  },
}));

beforeEach(() => {
  process.env.STELLAR_NETWORK = 'PUBLIC';
  process.env.STELLAR_FUNDER_SECRET = FUNDER_SECRET;
  process.env.STELLAR_FUNDER_PUBLIC = FUNDER_PUBLIC;
  process.env.FUNDER_DAILY_CAP = '100';
  process.env.FUNDER_BALANCE_FLOOR = '50';
  eventoAuditCount.mockReset().mockResolvedValue(0);
  eventoAuditCreate.mockReset().mockResolvedValue({});
});

afterEach(() => {
  process.env.STELLAR_NETWORK = ORIG.network;
  process.env.STELLAR_FUNDER_SECRET = ORIG.secret;
  process.env.STELLAR_FUNDER_PUBLIC = ORIG.pub;
  process.env.FUNDER_DAILY_CAP = ORIG.cap;
  process.env.FUNDER_BALANCE_FLOOR = ORIG.floor;
  vi.resetModules();
});

function makeFunderAccount(balanceXlm: string): unknown {
  // Stellar SDK exige sequenceNumber()/accountId() pra TransactionBuilder.
  // Compõe a partir de `Account` real + injeta `balances` que o handler lê.
  const acc = new Account(FUNDER_PUBLIC, '1') as Account & {
    balances?: Array<{ asset_type: string; balance: string }>;
  };
  acc.balances = [{ asset_type: 'native', balance: balanceXlm }];
  return acc;
}

describe('fundViaCreateAccount (N-09)', () => {
  it('throw quando WALLET_FUNDED count ≥ FUNDER_DAILY_CAP', async () => {
    eventoAuditCount.mockResolvedValueOnce(100);
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    vi.spyOn(account.horizon, 'loadAccount').mockRejectedValueOnce({
      response: { status: 404 },
    });
    await expect(account.fundAccountIfNeeded(DEST_PUBLIC)).rejects.toThrow(
      /daily cap atingido/,
    );
    // count foi consultado; create NÃO foi chamado (path bloqueado).
    expect(eventoAuditCount).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).not.toHaveBeenCalled();
  });

  it('log warn quando saldo do funder abaixo do floor (não bloqueia)', async () => {
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    // accountExists → false (destino novo).
    vi.spyOn(account.horizon, 'loadAccount')
      .mockRejectedValueOnce({ response: { status: 404 } })
      // loadAccount(funder) → balance baixo.
      .mockResolvedValueOnce(
        makeFunderAccount('30') as Awaited<
          ReturnType<typeof account.horizon.loadAccount>
        >,
      );
    const submitSpy = vi
      .spyOn(account.horizon, 'submitTransaction')
      .mockResolvedValueOnce({ hash: 'tx_fund' } as Awaited<
        ReturnType<typeof account.horizon.submitTransaction>
      >);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await account.fundAccountIfNeeded(DEST_PUBLIC);
    expect(r.funded).toBe(true);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('WALLET_FUNDED');
    expect(eventoAuditCreate.mock.calls[0][0].data.stellarTxHash).toBe(
      'tx_fund',
    );
    // Algum console.error com prefixo do funder.
    const sawFundedWarn = errSpy.mock.calls.some((c) =>
      String(c[0] ?? '').includes('[funder] saldo baixo'),
    );
    expect(sawFundedWarn).toBe(true);
    errSpy.mockRestore();
  });

  it('happy path: count below cap + balance ok → submit + audit', async () => {
    vi.resetModules();
    const account = await import('@/lib/stellar/account');
    vi.spyOn(account.horizon, 'loadAccount')
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce(
        makeFunderAccount('500') as Awaited<
          ReturnType<typeof account.horizon.loadAccount>
        >,
      );
    vi.spyOn(account.horizon, 'submitTransaction').mockResolvedValueOnce({
      hash: 'tx_ok',
    } as Awaited<ReturnType<typeof account.horizon.submitTransaction>>);

    const r = await account.fundAccountIfNeeded(DEST_PUBLIC);
    expect(r.funded).toBe(true);
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('WALLET_FUNDED');
  });
});
