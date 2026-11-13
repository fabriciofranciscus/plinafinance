import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Account, Asset, Memo, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { NavMudouError } from '@/lib/services/emissao';
import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { networkPassphrase } from '@/lib/stellar/config';

const USER = Keypair.random();
const USER_PK = USER.publicKey();
const OTHER_PK = Keypair.random().publicKey();
const DIST_PK = Keypair.random().publicKey();
const ISSUER = Keypair.random();

const {
  quoteFindUnique,
  quoteUpdateMany,
  quoteFindFirst,
  investidorUpdate,
  eventoAuditCreate,
  movimentoCreateMany,
  holdingUpsert,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
  assertElegivelParaTrustline,
  assertSwapXdrMatchesQuote,
  resolveTesouroAsset,
  preSignWithSigner,
  revalidarNav,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  quoteFindFirst: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  holdingUpsert: vi.fn(),
  submitWithPrivySignature: vi.fn(),
  txHashFromXdr: vi.fn(),
  fetchTransactionByHash: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  assertSwapXdrMatchesQuote: vi.fn(),
  resolveTesouroAsset: vi.fn(),
  preSignWithSigner: vi.fn(),
  revalidarNav: vi.fn(),
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
  db: {
    quote: { findUnique: quoteFindUnique, updateMany: quoteUpdateMany, findFirst: quoteFindFirst },
    $transaction: async (
      cb: (tx: {
        quote: { updateMany: typeof quoteUpdateMany };
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
        movimentoFundo: { createMany: typeof movimentoCreateMany };
        holdingPLINARF: { upsert: typeof holdingUpsert };
      }) => Promise<unknown>,
    ) =>
      cb({
        quote: { updateMany: quoteUpdateMany },
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoAuditCreate },
        movimentoFundo: { createMany: movimentoCreateMany },
        holdingPLINARF: { upsert: holdingUpsert },
      }),
  },
}));

// A rota usa txHashFromXdr + fetchTransactionByHash no submit-or-reconcile.
// Mock explícito (nada de importActual) pra manter o teste hermético: o real
// `fetchTransactionByHash` bate no Horizon.
vi.mock('@/lib/stellar/transactions', () => ({
  preSignWithSigner,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({ id: 'issuer' }) }));
vi.mock('@/lib/stellar/fee', () => ({ getDynamicFee: vi.fn().mockResolvedValue('100') }));
vi.mock('@/lib/services/emissao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/emissao')>();
  return { ...actual, revalidarNavDaCotacao: revalidarNav };
});
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));
vi.mock('@/lib/stellar/parse-swap-xdr', () => ({ assertSwapXdrMatchesQuote }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

// N1: as chaves públicas vêm só do env; o ISSUER assina no submit (depois de validar).
process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;

import { POST } from '@/app/api/investidor/buy/swap/submit/route';
import { ApiError } from '@/lib/api/errors';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** XDR real assinado pelo investidor (a rota confere a assinatura dele antes de assinar pela Plina). */
function realTx(amount = '1') {
  return new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount }))
    .setTimeout(0)
    .build();
}
const TX = realTx();
TX.sign(USER);
const ISSUER_SIG = 'issuer-sig-base64';

const FULL_BODY = {
  quoteId: 'q_1',
  signedXdr: TX.toXDR(),
};

/** sha256(hash da tx) — é o que a rota usa como chave de reserva (C-04). */
const XDR_HASH = createHash('sha256').update(TX.hash()).digest('hex');

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    fromAmount: new Prisma.Decimal('100'),
    toAmount: new Prisma.Decimal('99.5'),
    navPorTokenNaCotacao: new Prisma.Decimal('1'),
    plinarfAmount: new Prisma.Decimal('99.5'),
    investidor: { publicKey: 'GABC' },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: {},
    },
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  quoteFindFirst.mockReset().mockResolvedValue(null); // sem outro swap em conferência
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  holdingUpsert.mockReset().mockResolvedValue({});
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_real_hash' });
  txHashFromXdr.mockReset().mockReturnValue('tx_real_hash');
  preSignWithSigner.mockReset().mockReturnValue({ pubkey: ISSUER.publicKey(), sigBase64: ISSUER_SIG });
  revalidarNav.mockReset().mockResolvedValue(undefined);
  fetchTransactionByHash.mockReset().mockResolvedValue(null);
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
  assertSwapXdrMatchesQuote.mockReset();
  resolveTesouroAsset
    .mockReset()
    .mockResolvedValue({
      code: 'TESOURO',
      issuer: 'GTESOURO',
      identifier: 'TESOURO:GTESOURO',
    });
  process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;
});

// ---------------------------------------------------------------------------
// QA Vera — N1-at no submit: a guarda de trustline (em submitWithPrivySignature) recusa SEM rede,
// depois que a rota já reservou o quote. Aqui `submitWithPrivySignature` é o mock que lança o erro
// tipado real da guarda.
// ---------------------------------------------------------------------------
import { TrustlineNaoAutorizadaError } from '@/lib/stellar/trustline';

const recusa = (code: 'TRUSTLINE_AUSENTE' | 'TRUSTLINE_NAO_AUTORIZADA' = 'TRUSTLINE_NAO_AUTORIZADA') =>
  new TrustlineNaoAutorizadaError(code, USER_PK, `PLINARF:${ISSUER.publicKey()}`);

describe('QA N1-at — POST swap/submit com a trustline revogada entre o build e o submit', () => {
  it('caracterização: a guarda recusa (nada é escriturado nem emitido), mas a resposta é 500 genérico', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.error).toBe('erro interno');
    expect(j.code).toBeUndefined();
    expect(investidorUpdate).not.toHaveBeenCalled();
    expect(eventoAuditCreate).not.toHaveBeenCalled();
    expect(movimentoCreateMany).not.toHaveBeenCalled();
  });

  it('F-N1AT-1 (caracterização): a reserva do quote (submitXdrHash) fica ABERTA — ninguém chama liberarReservaDoSwap', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa());
    await POST(req(FULL_BODY));
    // só a reserva (where submitXdrHash:null); nenhuma chamada de liberação (where submitXdrHash:<hash>, data.submitXdrHash:null)
    expect(quoteUpdateMany).toHaveBeenCalledTimes(1);
    expect(quoteUpdateMany.mock.calls[0][0].where.submitXdrHash).toBeNull();
    const liberou = quoteUpdateMany.mock.calls.some((c) => c[0]?.data?.submitXdrHash === null);
    expect(liberou).toBe(false);
  });

  it.fails('F-N1AT-1 (esperado): recusa tipada 409 TRUSTLINE_NAO_AUTORIZADA e reserva LIBERADA (o gate SWAP_EM_VOO não fica fechado)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
    const liberou = quoteUpdateMany.mock.calls.some(
      (c) => c[0]?.where?.submitXdrHash === XDR_HASH && c[0]?.data?.submitXdrHash === null,
    );
    expect(liberou).toBe(true);
  });

  it('TRUSTLINE_AUSENTE tem o mesmo comportamento (500 e reserva aberta)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa('TRUSTLINE_AUSENTE'));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    expect(quoteUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('o 500 não vaza endereço de carteira, issuer nem mensagem da guarda', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa());
    const r = await POST(req(FULL_BODY));
    const txt = JSON.stringify(await r.json());
    expect(txt).not.toContain(USER_PK);
    expect(txt).not.toContain(ISSUER.publicKey());
    expect(txt).not.toContain('trustline');
  });

  it('retry do investidor com a MESMA xdr após a recusa: cai em reserva órfã, consulta a chain e (tx fora, envelope vigente) tenta de novo; sem duplicar escrituração', async () => {
    // envelope com maxTime vigente (a rota recusa re-assinar sem maxTime, 410)
    const tx = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
      .setTimeout(300)
      .build();
    tx.sign(USER);
    const body = { quoteId: 'q_1', signedXdr: tx.toXDR() };
    const hash = createHash('sha256').update(tx.hash()).digest('hex');

    // 1ª tentativa: recusa (500; reserva aberta)
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(recusa());
    expect((await POST(req(body))).status).toBe(500);

    // 2ª: a trustline foi autorizada nesse meio-tempo → emite
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: hash }))
      .mockResolvedValueOnce({ submitXdrHash: hash, consumedTxHash: null, consumedAt: null });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 }); // a reserva já existe
    quoteUpdateMany.mockResolvedValue({ count: 1 });
    fetchTransactionByHash.mockResolvedValueOnce(null);
    const r = await POST(req(body));
    expect(r.status).toBe(200);
    expect(submitWithPrivySignature).toHaveBeenCalledTimes(2);
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(movimentoCreateMany).toHaveBeenCalledOnce();
  });

  it('erro de rede no Horizon dentro da guarda (loadAccount) também deixa a reserva aberta (mesma classe do F-N1AT-1)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(new Error('Horizon 503'));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    expect(quoteUpdateMany).toHaveBeenCalledTimes(1);
  });
});
