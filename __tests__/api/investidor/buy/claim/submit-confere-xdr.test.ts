import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';

/**
 * claim/submit confere o XDR ANTES de qualquer caminho (fix/claim-submit-verify-xdr; Atlas + Argus adendo 1):
 * - source = investidor autenticado; ops = [changeTrust(ativo do CB, máx)?, claimClaimableBalance(CB da ordem)];
 * - caminho "já no ledger": exige successful E o efeito claimable_balance_claimed do investidor para o CB;
 * - não confere → 409 fixo, sem submeter e sem evento; tx_too_late → 409 XDR_EXPIRADO; resto → 500 fixo.
 */
const INV = Keypair.random().publicKey();
const OUTRO = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', ISSUER);
const FAKE = new Asset('FAKE', ISSUER);
const BAL = '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368';
const BAL_OUTRO = '000000005364e21565025f8c503f420c148228b28a189c1b67e076e495bc8462ee0176c9';

const {
  mockFindUnique,
  mockUpdate,
  mockEventoAuditCreate,
  mockDbTransaction,
  mockSubmitWithPrivySignature,
  mockFetchTransactionByHash,
  mockAtivoDoCb,
  mockClaimConfirmado,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockEventoAuditCreate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockSubmitWithPrivySignature: vi.fn(),
  mockFetchTransactionByHash: vi.fn(),
  mockAtivoDoCb: vi.fn(),
  mockClaimConfirmado: vi.fn(),
}));

let userPubkey = '';
vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, {
        user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: userPubkey },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    onRampOrder: { findUnique: mockFindUnique, update: mockUpdate },
    eventoAudit: { create: mockEventoAuditCreate },
    $transaction: mockDbTransaction,
  },
}));

vi.mock('@/lib/stellar/transactions', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/transactions')>()),
  submitWithPrivySignature: mockSubmitWithPrivySignature,
  fetchTransactionByHash: mockFetchTransactionByHash,
}));

vi.mock('@/lib/stellar/claim', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/claim')>()),
  ativoDoClaimableBalance: mockAtivoDoCb,
  claimConfirmadoNaTx: mockClaimConfirmado,
}));

import { POST } from '@/app/api/investidor/buy/claim/submit/route';
import { txHashFromXdr } from '@/lib/stellar/transactions';

function envelope(ops: unknown[], source = INV): string {
  const b = new TransactionBuilder(new Account(source, '100'), { fee: '100', networkPassphrase });
  for (const op of ops) b.addOperation(op as ReturnType<typeof Operation.claimClaimableBalance>);
  return b.setTimeout(120).build().toXDR();
}
const claim = (balanceId = BAL) => Operation.claimClaimableBalance({ balanceId });
const trust = (asset = TESOURO) => Operation.changeTrust({ asset });

function req(xdr: string): Request {
  return new Request('http://x/claim/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: 'order-x', xdr, signatureHex: '0xsig' }),
  });
}

const ORDEM = { id: 'order-x', investidorId: 'inv_1', claimTxHash: null, stellarClaimableBalanceId: BAL };

function semEfeito() {
  expect(mockSubmitWithPrivySignature).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEventoAuditCreate).not.toHaveBeenCalled();
}

beforeEach(() => {
  userPubkey = INV;
  mockFindUnique.mockReset().mockResolvedValue({ ...ORDEM });
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockEventoAuditCreate.mockReset().mockResolvedValue(undefined);
  mockDbTransaction.mockReset().mockImplementation(async (fn) =>
    fn({
      onRampOrder: { update: mockUpdate },
      eventoAudit: { create: mockEventoAuditCreate },
      $queryRaw: async () => [{ claimTxHash: null }], // trava da linha da ordem (submit-concorrente-pg cobre o real)
    }),
  );
  mockSubmitWithPrivySignature.mockReset().mockImplementation(async ({ xdr }: { xdr: string }) => ({
    hash: txHashFromXdr(xdr),
  }));
  mockFetchTransactionByHash.mockReset().mockResolvedValue(null);
  mockAtivoDoCb.mockReset().mockResolvedValue(TESOURO);
  mockClaimConfirmado.mockReset().mockResolvedValue(TESOURO);
});

describe('claim/submit — envelope válido', () => {
  it('sem trustline (só o claim) → 200, submete e audita', async () => {
    const xdr = envelope([claim()]);
    const r = await POST(req(xdr));
    expect(r.status).toBe(200);
    expect((await r.json()).claimTxHash).toBe(txHashFromXdr(xdr));
    expect(mockSubmitWithPrivySignature).toHaveBeenCalledWith({
      xdr,
      investorPubkey: INV,
      investorSignatureHex: '0xsig',
    });
    expect(mockEventoAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acao: 'CLAIMABLE_BALANCE_RESGATADA', stellarTxHash: txHashFromXdr(xdr) }),
      }),
    );
  });

  it('com changeTrust(TESOURO) + claim → 200, submete e audita', async () => {
    const xdr = envelope([trust(), claim()]);
    const r = await POST(req(xdr));
    expect(r.status).toBe(200);
    expect(mockSubmitWithPrivySignature).toHaveBeenCalledTimes(1);
    expect(mockEventoAuditCreate).toHaveBeenCalledTimes(1);
  });

  it('já no ledger com sucesso e com o efeito do claim → 200 sem re-submeter', async () => {
    const xdr = envelope([trust(), claim()]);
    mockFetchTransactionByHash.mockResolvedValue({ hash: txHashFromXdr(xdr), successful: true });
    const r = await POST(req(xdr));
    expect(r.status).toBe(200);
    expect(mockClaimConfirmado).toHaveBeenCalledWith(txHashFromXdr(xdr), { investorPubkey: INV, balanceId: BAL });
    expect(mockSubmitWithPrivySignature).not.toHaveBeenCalled();
    expect(mockEventoAuditCreate).toHaveBeenCalledTimes(1);
  });
});

describe('claim/submit — envelope que não confere → 409, sem submeter e sem evento', () => {
  it('tx de OUTRA conta já no ledger (com sucesso) → 409', async () => {
    const xdr = envelope([claim()], OUTRO);
    mockFetchTransactionByHash.mockResolvedValue({ hash: txHashFromXdr(xdr), successful: true });
    const r = await POST(req(xdr));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('XDR_NAO_CONFERE');
    expect(mockFetchTransactionByHash).not.toHaveBeenCalled(); // confere ANTES do caminho do ledger
    semEfeito();
  });

  it('claim de outro balanceId → 409', async () => {
    const r = await POST(req(envelope([claim(BAL_OUTRO)])));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('op extra (payment) → 409', async () => {
    const pay = Operation.payment({ destination: OUTRO, asset: Asset.native(), amount: '1' });
    const r = await POST(req(envelope([trust(), claim(), pay])));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('changeTrust de outro ativo (CB é TESOURO) → 409', async () => {
    const r = await POST(req(envelope([trust(FAKE), claim()])));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('já no ledger: changeTrust de outro ativo vs o ativo do claim no efeito → 409', async () => {
    const xdr = envelope([trust(FAKE), claim()]);
    mockFetchTransactionByHash.mockResolvedValue({ hash: txHashFromXdr(xdr), successful: true });
    const r = await POST(req(xdr));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('já no ledger mas NÃO successful → 409', async () => {
    const xdr = envelope([claim()]);
    mockFetchTransactionByHash.mockResolvedValue({ hash: txHashFromXdr(xdr), successful: false });
    const r = await POST(req(xdr));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('já no ledger com sucesso mas sem o efeito do claim desse CB → 409', async () => {
    const xdr = envelope([claim()]);
    mockFetchTransactionByHash.mockResolvedValue({ hash: txHashFromXdr(xdr), successful: true });
    mockClaimConfirmado.mockResolvedValue(null);
    const r = await POST(req(xdr));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('CB não existe mais e a tx não está no ledger → 409', async () => {
    mockAtivoDoCb.mockResolvedValue(null);
    const r = await POST(req(envelope([claim()])));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('ordem sem stellarClaimableBalanceId → 409', async () => {
    mockFindUnique.mockResolvedValue({ ...ORDEM, stellarClaimableBalanceId: null });
    const r = await POST(req(envelope([claim()])));
    expect(r.status).toBe(409);
    semEfeito();
  });

  it('XDR ilegível → 409 (não 500)', async () => {
    const r = await POST(req('AAAA'));
    expect(r.status).toBe(409);
    semEfeito();
  });
});

describe('claim/submit — erros do submit', () => {
  it('tx_too_late → 409 XDR_EXPIRADO, sem evento', async () => {
    mockSubmitWithPrivySignature.mockRejectedValue(
      Object.assign(new Error('Bad Request'), {
        response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_too_late' } } } },
      }),
    );
    const r = await POST(req(envelope([claim()])));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('XDR_EXPIRADO');
    expect(mockEventoAuditCreate).not.toHaveBeenCalled();
  });

  it('erro inesperado → 500 fixo, sem err.message no corpo', async () => {
    mockSubmitWithPrivySignature.mockRejectedValue(new Error('SEGREDO postgres://u:p@h/db'));
    const r = await POST(req(envelope([claim()])));
    expect(r.status).toBe(500);
    const corpo = await r.text();
    expect(corpo).not.toContain('SEGREDO');
    expect(JSON.parse(corpo)).toEqual({ error: 'erro interno' });
    expect(mockEventoAuditCreate).not.toHaveBeenCalled();
  });
});
