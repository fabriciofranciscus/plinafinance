import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Transaction } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';

const INVESTOR_PUBKEY = 'GCV34BIZKP6ATAOI3RTQQ7CRL5KOP3XCEEYQYB3ZD654CMO6XNJQQ5TQ';
const BALANCE_ID =
  '00000000618ee983898fa615b366c1efa396864d5f05808bc91ea0467eb0f0bf360a9af3';

const TESOURO_ISSUER = 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';

const { mockFindUnique, mockLoadAccount, mockCb } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadAccount: vi.fn(),
  mockCb: vi.fn(),
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
          publicKey: INVESTOR_PUBKEY,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: { onRampOrder: { findUnique: mockFindUnique } },
}));

vi.mock('@/lib/stellar/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/account')>(
    '@/lib/stellar/account',
  );
  return {
    ...actual,
    horizon: { loadAccount: mockLoadAccount, claimableBalances: () => ({ claimableBalance: () => ({ call: mockCb }) }) },
  };
});

// O fee não é o assunto desta rota, e o `getDynamicFee` real chamaria o Horizon de
// verdade (rede + timeout intermitente sob carga). Mock explícito, sem importActual.
vi.mock('@/lib/stellar/fee', () => ({
  getDynamicFee: vi.fn(async () => '100'),
  getFeeOfertaInvestidor: vi.fn(async () => '100'), // harness (fix/swap-fee-surge)
  _resetFeeCacheForTests: vi.fn(),
}));

import { POST } from '@/app/api/investidor/buy/claim/build/route';

function req(body: object): Request {
  return new Request('http://x/claim/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type Bal = Record<string, string>;
/** Conta do investidor: XLM suficiente para uma trustline nova, com ou sem a trustline TESOURO. */
function conta(opts: { tesouro?: boolean; xlm?: string } = {}) {
  const balances: Bal[] = [{ asset_type: 'native', balance: opts.xlm ?? '5.0000000', selling_liabilities: '0.0000000' }];
  if (opts.tesouro) balances.push({ asset_type: 'credit_alphanum12', asset_code: 'TESOURO', asset_issuer: TESOURO_ISSUER, balance: '0.0000000' });
  return Object.assign(new Account(INVESTOR_PUBKEY, '12345'), { balances, subentry_count: opts.tesouro ? 1 : 0, num_sponsoring: 0, num_sponsored: 0 });
}
const cb = (over: Record<string, unknown> = {}) => ({
  id: BALANCE_ID, asset: `TESOURO:${TESOURO_ISSUER}`, amount: '85.4949410', claimants: [{ destination: INVESTOR_PUBKEY }], ...over,
});
const ORDEM = { id: 'order-x', investidorId: 'inv_1', stellarClaimableBalanceId: BALANCE_ID };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mockFindUnique.mockReset();
  mockLoadAccount.mockReset().mockResolvedValue(conta({ tesouro: true }));
  mockCb.mockReset().mockResolvedValue(cb());
});

describe('POST /api/investidor/buy/claim/build (PLINA-MOD-007)', () => {
  it('400 sem orderId', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('404 order inexistente', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(404);
  });

  it('403 order pertence a outro investidor', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'OUTRO',
      stellarClaimableBalanceId: BALANCE_ID,
    });
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(403);
  });

  it('409 sem stellarClaimableBalanceId (order não completou)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'order-x',
      investidorId: 'inv_1',
      stellarClaimableBalanceId: null,
    });
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(409);
  });

  it('200 com a trustline TESOURO já aberta: envelope SÓ com o claim (idempotente)', async () => {
    mockFindUnique.mockResolvedValueOnce(ORDEM);
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.xdr).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(json.hashHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(json.balanceId).toBe(BALANCE_ID);

    const tx = new Transaction(json.xdr, networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as { type: string; balanceId: string };
    expect(op.type).toBe('claimClaimableBalance');
    expect(op.balanceId).toBe(BALANCE_ID);
    expect(json.operacoes).toEqual(['claimClaimableBalance']);
  });

  it('E2 (Vera): SEM a trustline TESOURO, o MESMO envelope leva changeTrust(TESOURO) ANTES do claim, source = investidor (op_no_trust some)', async () => {
    mockLoadAccount.mockResolvedValue(conta({ tesouro: false }));
    mockFindUnique.mockResolvedValueOnce(ORDEM);
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.operacoes).toEqual(['changeTrust', 'claimClaimableBalance']);
    const tx = new Transaction(json.xdr, networkPassphrase);
    expect(tx.source).toBe(INVESTOR_PUBKEY);
    expect(tx.operations.map((o) => o.type)).toEqual(['changeTrust', 'claimClaimableBalance']);
    const trust = tx.operations[0] as unknown as { line: { code: string; issuer: string }; limit: string };
    expect(trust.line.code).toBe('TESOURO');
    expect(trust.line.issuer).toBe(TESOURO_ISSUER);
    expect((tx.operations[1] as { balanceId: string }).balanceId).toBe(BALANCE_ID);
    expect(json.hashHex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('sem trustline e sem XLM para a reserva → 409 RESERVA_INSUFICIENTE com o aporte exato (mensagem fixa)', async () => {
    mockLoadAccount.mockResolvedValue(conta({ tesouro: false, xlm: '1.0000000' }));
    mockFindUnique.mockResolvedValueOnce(ORDEM);
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe('RESERVA_INSUFICIENTE');
    expect(j.aporteXlm).toMatch(/^\d+\.\d{7}$/);
    expect(Object.keys(j).sort()).toEqual(['aporteXlm', 'code', 'error']);
  });

  it('CB já resgatado/inexistente → 409 CB_NOT_FOUND; carteira não é claimant → 403 NOT_CLAIMANT; carteira ausente → 409 ACCOUNT_MISSING', async () => {
    mockFindUnique.mockResolvedValue(ORDEM);
    mockCb.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
    const a = await POST(req({ orderId: 'order-x' }));
    expect(a.status).toBe(409);
    expect((await a.json()).code).toBe('CB_NOT_FOUND');
    mockCb.mockResolvedValueOnce(cb({ claimants: [{ destination: 'GOUTRA' }] }));
    const b = await POST(req({ orderId: 'order-x' }));
    expect(b.status).toBe(403);
    expect((await b.json()).code).toBe('NOT_CLAIMANT');
    mockLoadAccount.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
    const c = await POST(req({ orderId: 'order-x' }));
    expect(c.status).toBe(409);
    expect((await c.json()).code).toBe('ACCOUNT_MISSING');
  });

  it('falha inesperada → 500 FIXO "erro interno" (nunca a mensagem do erro)', async () => {
    mockFindUnique.mockResolvedValueOnce(ORDEM);
    mockCb.mockRejectedValueOnce(new Error('horizon caiu com segredo xyz'));
    const r = await POST(req({ orderId: 'order-x' }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
});
